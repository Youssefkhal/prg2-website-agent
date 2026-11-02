import * as fs from "node:fs";
import * as path from "node:path";
import { createMiddleware } from "langchain";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { SkillRegistry } from "../skills/skill-registry";
import type { ToolRegistry } from "../tools/tool-registry";

/**
 * Dynamic context middleware = "only what is needed is in the context".
 *
 * Every model call:
 *   1. finds the latest user request and retrieves the few most relevant skills from the
 *      (possibly huge) skill library → only their name + one-line description are injected;
 *   2. lists the skills already loaded in this conversation (via `load_skill`);
 *   3. binds ONLY the dynamic tools required by loaded skills or enabled with `enable_tools`.
 * Tool execution of dynamic tools is resolved in `wrapToolCall` (LangChain's documented
 * pattern for dynamically registered tools), so tools added at runtime work without
 * rebuilding the agent.
 */

import { scanConversation } from "./conversation-scan";

export { scanConversation };

/** Simple shared rate limiter for model calls (free-tier APIs allow only a few requests per minute). */
function createRateLimiter(rpm: number) {
  if (!rpm || rpm <= 0) return async () => {};
  const interval = 60_000 / rpm;
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

export function createDynamicContextMiddleware(skills: SkillRegistry, tools: ToolRegistry, opts: { autoSuggest: number; modelRpm?: number }) {
  const throttle = createRateLimiter(opts.modelRpm ?? 0);
  const searchSkills = tool(
    async ({ query, k }) => {
      const hits = await skills.search(query, k ?? 6);
      if (!hits.length) return `No skill matches "${query}". Try other keywords (English or French).`;
      return hits.map((s) => `- ${s.name} (score ${s.score}): ${s.description}${s.tools.length ? ` [tools: ${s.tools.join(", ")}]` : ""}`).join("\n");
    },
    {
      name: "search_skills",
      description: "Search the skill library for expert procedures relevant to a sub-task. Returns names + descriptions; then call load_skill.",
      schema: z.object({ query: z.string().describe("What you need to do, in a few words"), k: z.number().int().min(1).max(15).optional() }),
    },
  );
  // keep the live size in the description
  Object.defineProperty(searchSkills, "description", {
    get: () =>
      `Search the skill library (${skills.size} skills, NOT listed in your prompt) for expert procedures relevant to a sub-task. Returns names + descriptions; then call load_skill.`,
  });

  const loadSkill = tool(
    async ({ name, file }) => {
      const meta = skills.get(name);
      if (!meta) {
        const alt = await skills.search(name, 3);
        return `Unknown skill "${name}".${alt.length ? " Did you mean: " + alt.map((a) => a.name).join(", ") : ""}`;
      }
      const dir = path.dirname(meta.path);
      if (file) {
        const full = path.resolve(dir, file);
        if (!full.startsWith(dir) || !fs.existsSync(full)) return `File "${file}" not found in skill ${name}.`;
        return fs.readFileSync(full, "utf8").slice(0, 20000);
      }
      const extra = fs
        .readdirSync(dir)
        .filter((f) => f !== "SKILL.md")
        .slice(0, 30);
      const header = [`SKILL LOADED: ${name}`];
      if (meta.tools.length) header.push(`Tools now available to you: ${meta.tools.join(", ")}`);
      if (extra.length) header.push(`Extra resources (read with load_skill(name, file)): ${extra.join(", ")}`);
      return header.join("\n") + "\n\n" + (skills.readBody(name) ?? "");
    },
    {
      name: "load_skill",
      description:
        "Load the full instructions of a skill (and activate the tools it declares). Optionally read one of its resource files with `file`.",
      schema: z.object({ name: z.string(), file: z.string().optional() }),
    },
  );

  const searchTools = tool(
    async ({ query }) =>
      tools
        .search(query, 6)
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n") || "No tool found.",
    {
      name: "search_tools",
      description: "Search the dynamic tool registry (image generation on GPU, palettes, audits, HTTP APIs registered at runtime…). Then call enable_tools.",
      schema: z.object({ query: z.string() }),
    },
  );

  const enableTools = tool(
    async ({ names }) => {
      const ok = names.filter((n) => tools.has(n));
      const bad = names.filter((n) => !tools.has(n));
      return `${ok.length ? `Enabled: ${ok.join(", ")} (available from your next step).` : ""}${bad.length ? ` Unknown: ${bad.join(", ")}.` : ""}`.trim();
    },
    {
      name: "enable_tools",
      description: "Add dynamic tools (found with search_tools) to your toolset for the rest of the conversation.",
      schema: z.object({ names: z.array(z.string()).min(1) }),
    },
  );

  return createMiddleware({
    name: "DynamicContextMiddleware",
    tools: [searchSkills, loadSkill, searchTools, enableTools],

    wrapModelCall: async (request: any, handler: any) => {
      const { loadedSkills, enabledTools, lastUserText } = scanConversation(request.messages ?? []);

      // 1) dynamic tools: only those needed right now
      const wanted = new Set<string>(enabledTools);
      for (const s of loadedSkills) for (const t of skills.get(s)?.tools ?? []) wanted.add(t);
      const present = new Set((request.tools ?? []).map((t: any) => t?.name));
      const extraTools = [...wanted].filter((n) => !present.has(n) && tools.has(n)).map((n) => tools.get(n)!.tool);

      // 2) skills: a handful of suggestions instead of the whole catalogue
      const suggestions = lastUserText && opts.autoSuggest > 0 ? (await skills.search(lastUserText, opts.autoSuggest + loadedSkills.length)).filter((s) => !loadedSkills.includes(s.name)).slice(0, opts.autoSuggest) : [];

      const section = [
        "",
        "## Skills & dynamic tools",
        `A library of ${skills.size} skills exists but is NOT listed here (to save context). Use \`search_skills\` to find more and \`load_skill\` to read one before doing a specialised task.`,
        suggestions.length ? "Suggested for the current request:\n" + suggestions.map((s) => `- ${s.name}: ${s.description}`).join("\n") : "",
        loadedSkills.length ? `Already loaded in this conversation (do not reload): ${loadedSkills.join(", ")}` : "",
        `Dynamic tools currently bound: ${[...wanted].filter((n) => tools.has(n)).join(", ") || "none"}. Others (${tools.list().length} total) can be found with \`search_tools\` and activated with \`enable_tools\` or by loading a skill that declares them.`,
      ]
        .filter(Boolean)
        .join("\n");

      await throttle();
      return handler({
        ...request,
        systemMessage: request.systemMessage.concat(section),
        tools: [...(request.tools ?? []), ...extraTools],
      });
    },

    wrapToolCall: async (request: any, handler: any) => {
      if (request.tool === undefined) {
        const entry = tools.get(request.toolCall?.name);
        if (entry) return handler({ ...request, tool: entry.tool });
      }
      return handler(request);
    },
  } as any);
}
