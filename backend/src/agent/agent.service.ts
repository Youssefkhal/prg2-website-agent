import * as fs from "node:fs";
import * as path from "node:path";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { modelFallbackMiddleware } from "langchain";
import { config } from "../config";
import { RegistryService } from "../registry/registry.service";
import { currentContext, projectDirFor, runContext, sanitizeThreadId } from "../run-context";
import { generateImageTool } from "../tools/tool-registry";
import { slugify } from "../tools/web-utils";
import { createDynamicContextMiddleware } from "./dynamic-context.middleware";
import { createChatModel, createChatModelFromSettings, type RuntimeModelSettings } from "./model-factory";
import { COPYWRITER_PROMPT, IMAGE_DESIGNER_PROMPT, MAIN_SYSTEM_PROMPT, QA_PROMPT, WEB_DEVELOPER_PROMPT } from "./prompts";

export interface ImageInput {
  name: string;
  /** data:image/png;base64,... */
  dataUrl: string;
}

export interface ModelInfo {
  configured: boolean;
  source: "ui" | "override" | "env";
  provider: string | null;
  model: string;
  baseUrl: string | null;
  label: string;
}

export type AgentEvent =
  | { type: "token"; agent: string; text: string }
  | { type: "tool_call"; agent: string; index: number; id?: string; name: string }
  | { type: "tool_args"; agent: string; index: number; delta: string }
  | { type: "tool_result"; agent: string; name: string; toolCallId?: string; content: string }
  | { type: "uploads"; files: string[] }
  | { type: "done" }
  | { type: "error"; message: string };

const msgType = (m: any): string => m?.type ?? m?._getType?.() ?? "";
const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (b?.type === "text" || b?.type === "text_delta" ? b.text ?? "" : "")).join("") : "";

@Injectable()
export class AgentService {
  private readonly log = new Logger("Agent");
  private readonly checkpointer = new MemorySaver();
  private agent: any;
  private readonly busy = new Set<string>();
  /** Optional model instance (tests inject a scripted model). */
  private modelOverride?: unknown;
  /** Model configured from the web interface; the API key lives in this process only. */
  private runtimeModel?: unknown;
  private runtimeSettings?: Omit<RuntimeModelSettings, "apiKey">;

  setModel(model: unknown): void {
    this.modelOverride = model;
    this.agent = undefined;
  }

  /** Apply provider/model/key submitted by the user in the web interface. Does not log or persist the key. */
  configureModel(settings: RuntimeModelSettings): ModelInfo {
    const model = createChatModelFromSettings(settings);
    this.runtimeModel = model;
    this.runtimeSettings = {
      provider: settings.provider,
      model: settings.model.trim(),
      baseUrl: settings.baseUrl?.trim() || undefined,
    };
    this.agent = undefined;
    this.log.log(`runtime model configured: ${settings.provider}:${settings.model.trim()}`);
    return this.modelInfo();
  }

  /** Forget the UI-supplied model; the next chat falls back to the .env configuration. */
  clearModel(): ModelInfo {
    this.runtimeModel = undefined;
    this.runtimeSettings = undefined;
    this.agent = undefined;
    this.log.log("runtime model cleared");
    return this.modelInfo();
  }

  /** Public status; never includes the API key. */
  modelInfo(): ModelInfo {
    const envKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY);
    const configured = !!(this.runtimeModel || this.modelOverride || envKey);
    const provider = this.runtimeSettings?.provider ?? (this.modelOverride ? "override" : null);
    const model = this.runtimeSettings?.model ?? config.model;
    return {
      configured,
      source: this.runtimeModel ? "ui" : this.modelOverride ? "override" : "env",
      provider,
      model,
      baseUrl: this.runtimeSettings?.baseUrl ?? null,
      label: configured && provider ? `${provider}:${model}` : config.model,
    };
  }

  constructor(@Inject(RegistryService) private readonly registry: RegistryService) {}

  /** Build the deep agent once; dynamic skills/tools are resolved at call time, so no rebuild is needed when they change. */
  private getAgent(): any {
    if (this.agent) return this.agent;
    const { skills, tools } = this.registry;
    const dynamic = createDynamicContextMiddleware(skills, tools, { autoSuggest: config.autoSuggestSkills, modelRpm: config.modelRpm });
    const primary = this.modelOverride ?? this.runtimeModel ?? createChatModel(config.model);
    const subModel = this.modelOverride ?? this.runtimeModel ?? createChatModel(config.subagentModel);
    // Fallback models (e.g. other Gemini Flash versions when one is overloaded), outermost so they wrap the whole call.
    const fallbacks = this.modelOverride || this.runtimeModel ? [] : config.modelFallbacks.map((m) => createChatModel(m));
    const mw: any[] = fallbacks.length ? [modelFallbackMiddleware(...fallbacks), dynamic] : [dynamic];

    this.agent = createDeepAgent({
      name: "atelier",
      model: primary as any,
      systemPrompt: MAIN_SYSTEM_PROMPT,
      tools: [],
      middleware: mw,
      checkpointer: this.checkpointer,
      // Real files on disk, one folder per conversation/project: backend/workspace/<threadId>/
      backend: () => new FilesystemBackend({ rootDir: currentContext().projectDir, virtualMode: true }),
      subagents: [
        {
          name: "copywriter",
          description: "Writes all website copy (titles, meta descriptions, sections, CTAs, alt texts) into /content/*.md from /brief.md.",
          systemPrompt: COPYWRITER_PROMPT,
          tools: [],
          middleware: mw,
          ...(subModel ? { model: subModel } : {}),
        },
        {
          name: "image-designer",
          description:
            "Art director: generates the website images (hero, sections, team/office scenes…) on the Colab T4 GPU with generate_image, consistent with the brand. Give it the list of images, sizes and art direction.",
          systemPrompt: IMAGE_DESIGNER_PROMPT,
          tools: [generateImageTool],
          middleware: mw,
          ...(subModel ? { model: subModel } : {}),
        },
        {
          name: "web-developer",
          description: "Front-end developer: builds the responsive static site in /site (HTML, CSS, JS) from /brief.md, /content and the images.",
          systemPrompt: WEB_DEVELOPER_PROMPT,
          tools: [],
          middleware: mw,
          ...(subModel ? { model: subModel } : {}),
        },
        {
          name: "qa-reviewer",
          description: "Audits the finished site (SEO, accessibility, broken links/images, consistency) and fixes the problems.",
          systemPrompt: QA_PROMPT,
          tools: [tools.get("audit_website")!.tool],
          middleware: mw,
          ...(subModel ? { model: subModel } : {}),
        },
      ],
    } as any);
    this.log.log(`deep agent ready (model ${this.modelInfo().label})`);
    return this.agent;
  }

  /** Save uploaded images into the project so the site can use them (logo, photos…). */
  private saveUploads(images: ImageInput[]): string[] {
    const { projectDir } = currentContext();
    const dir = path.join(projectDir, "site", "assets", "uploads");
    fs.mkdirSync(dir, { recursive: true });
    return images.map((img) => {
      const m = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,(.+)$/i.exec(img.dataUrl);
      if (!m) throw new Error(`unsupported image ${img.name} (png, jpg, webp, gif, svg)`);
      const ext = m[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
      let file = `${slugify(img.name)}.${ext}`;
      for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${slugify(img.name)}-${i}.${ext}`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], "base64"));
      return `/site/assets/uploads/${file}`;
    });
  }

  async *chat(threadIdRaw: string, text: string, images: ImageInput[] = []): AsyncGenerator<AgentEvent> {
    const threadId = sanitizeThreadId(threadIdRaw);
    if (this.busy.has(threadId)) {
      yield { type: "error", message: "This project is already running a task — wait for it to finish." };
      return;
    }
    this.busy.add(threadId);
    const ctx = { threadId, projectDir: projectDirFor(threadId) };
    // Bridge: the agent runs inside the AsyncLocalStorage context, events are pushed to this generator.
    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    const push = (e: AgentEvent) => {
      queue.push(e);
      wake?.();
    };

    void runContext.run(ctx, async () => {
      try {
        const saved = images.length ? this.saveUploads(images) : [];
        if (saved.length) push({ type: "uploads", files: saved });
        const note = saved.length
          ? `\n\n[Attached images saved in the project: ${saved.join(", ")} — use them in the website with relative paths like "assets/uploads/<file>".]`
          : "";
        const content: any[] = [{ type: "text", text: (text || "(see attached images)") + note }];
        for (const img of images) content.push({ type: "image_url", image_url: { url: img.dataUrl } });

        const stream = await this.getAgent().stream(
          { messages: [{ role: "user", content }] },
          { streamMode: "messages", subgraphs: true, configurable: { thread_id: threadId }, recursionLimit: config.recursionLimit },
        );
        const nsAgent = new Map<string, string>();
        for await (const item of stream as AsyncIterable<any>) {
          const [ns, payload] = item as [string[], [any, any]];
          const [msg, meta] = payload ?? [];
          if (!msg) continue;
          const sub = (ns ?? []).find((s) => s.startsWith("tools:"));
          if (sub && meta?.lc_agent_name && meta.lc_agent_name !== "atelier") nsAgent.set(sub, meta.lc_agent_name);
          const agent = sub ? nsAgent.get(sub) ?? "sub-agent" : "atelier";
          const type = msgType(msg);

          if (type === "tool") {
            push({ type: "tool_result", agent, name: msg.name ?? "", toolCallId: msg.tool_call_id, content: textOf(msg.content).slice(0, 1500) });
            continue;
          }
          if (type !== "ai" && type !== "AIMessageChunk") continue;
          for (const tc of msg.tool_call_chunks ?? []) {
            const index = tc.index ?? 0;
            if (tc.name) push({ type: "tool_call", agent, index, id: tc.id, name: tc.name });
            if (tc.args) push({ type: "tool_args", agent, index, delta: tc.args });
          }
          const t = typeof msg.text === "string" ? msg.text : textOf(msg.content);
          if (t) push({ type: "token", agent, text: t });
        }
        push({ type: "done" });
      } catch (e: any) {
        this.log.error(e?.stack ?? e);
        push({ type: "error", message: e?.message ?? String(e) });
      } finally {
        finished = true;
        this.busy.delete(threadId);
        wake?.();
      }
    });

    while (true) {
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (finished) break;
      await new Promise<void>((r) => (wake = r));
      wake = null;
    }
  }

  /** Conversation history (for reloading the UI). */
  async history(threadIdRaw: string): Promise<{ role: string; text: string }[]> {
    const threadId = sanitizeThreadId(threadIdRaw);
    const ctx = { threadId, projectDir: projectDirFor(threadId) };
    return runContext.run(ctx, async () => {
      const state = await this.getAgent().getState({ configurable: { thread_id: threadId } });
      const msgs: any[] = state?.values?.messages ?? [];
      return msgs
        .filter((m) => ["human", "ai"].includes(msgType(m)) && textOf(m.content).trim())
        .map((m) => ({ role: msgType(m) === "human" ? "user" : "assistant", text: textOf(m.content) }));
    });
  }
}
