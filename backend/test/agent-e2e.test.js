// End-to-end test of the real deep agent graph (deepagents + middleware + sub-agents + streaming)
// with a scripted chat model instead of an LLM API, so it runs in CI without any key.
// It checks: skill loading → dynamic tool binding → generate_image → write_file → task(qa-reviewer)
// → audit_website inside the sub-agent → files on disk → SSE-style events.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WS = fs.mkdtempSync(path.join(os.tmpdir(), "ws-"));
process.env.WORKSPACE_DIR = WS;
process.env.COLAB_GPU_URL = ""; // placeholder images (no GPU in CI)
process.env.AUTO_SUGGEST_SKILLS = "4";

const { BaseChatModel } = require("@langchain/core/language_models/chat_models");
const { AIMessage } = require("@langchain/core/messages");
require("reflect-metadata");
const { RegistryService } = require("../dist/registry/registry.service");
const { AgentService } = require("../dist/agent/agent.service");

const log = { systemPrompts: [], boundToolsPerCall: [] };
const text = (m) => (typeof m.content === "string" ? m.content : (m.content || []).map((b) => b.text || "").join(""));
const type = (m) => m.type || (m._getType && m._getType());

class ScriptedModel extends BaseChatModel {
  constructor(tools = []) {
    super({});
    this.boundTools = tools;
  }
  _llmType() {
    return "scripted";
  }
  bindTools(tools) {
    return new ScriptedModel(tools);
  }
  async _generate(messages) {
    const system = text(messages.find((m) => type(m) === "system") || { content: "" });
    const toolMsgs = messages.filter((m) => type(m) === "tool").length;
    const names = this.boundTools.map((t) => t.name || t.function?.name);
    log.systemPrompts.push(system);
    log.boundToolsPerCall.push(names);
    const call = (name, args) =>
      new AIMessage({ content: "", tool_calls: [{ name, args, id: `call_${name}_${toolMsgs}`, type: "tool_call" }] });
    let msg;
    if (system.includes("QA reviewer")) {
      msg = toolMsgs === 0 ? call("audit_website", {}) : new AIMessage("QA done: no errors.");
    } else {
      const script = [
        () => call("load_skill", { name: "image-prompting-sdxl" }),
        () => call("generate_image", { prompt: "modern office with solar panels", filename: "hero", width: 768, height: 512 }),
        () =>
          call("write_file", {
            file_path: "/site/index.html",
            content:
              '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Test</title><meta name="description" content="Test site"></head><body><h1>Hello</h1><img src="assets/images/hero.svg" alt="Hero"></body></html>',
          }),
        () => call("task", { subagent_type: "qa-reviewer", description: "Audit the website in /site and fix errors." }),
        () => new AIMessage("Website ready: /site/index.html"),
      ];
      msg = script[Math.min(toolMsgs, script.length - 1)]();
    }
    return { generations: [{ text: text(msg), message: msg }] };
  }
}

test("deep agent builds a site with dynamic skills, dynamic tools and a sub-agent", { timeout: 120000 }, async () => {
  const registry = new RegistryService();
  registry.onModuleInit();
  const agent = new AgentService(registry);
  agent.setModel(new ScriptedModel());

  const events = [];
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  for await (const ev of agent.chat("e2e", "Crée le site vitrine d'une entreprise de panneaux solaires", [{ name: "logo", dataUrl: tinyPng }])) {
    events.push(ev);
  }
  registry.onModuleDestroy();

  const err = events.find((e) => e.type === "error");
  assert.equal(err, undefined, err && err.message);
  assert.equal(events.at(-1).type, "done");

  // multimodal upload saved in the project
  assert.ok(fs.existsSync(path.join(WS, "e2e", "site", "assets", "uploads", "logo.png")));

  // dynamic context: skills suggested, catalogue not listed
  const mainPrompt = log.systemPrompts[0];
  assert.match(mainPrompt, /A library of \d+ skills exists but is NOT listed here/);
  assert.match(mainPrompt, /Suggested for the current request/);

  // generate_image NOT bound before the skill is loaded, bound after
  assert.ok(!log.boundToolsPerCall[0].includes("generate_image"), "generate_image should not be bound on the first call");
  assert.ok(log.boundToolsPerCall[1].includes("generate_image"), "generate_image should be bound after load_skill");

  // tools ran and wrote real files
  const site = path.join(WS, "e2e", "site");
  assert.ok(fs.existsSync(path.join(site, "assets", "images", "hero.svg")), "placeholder image written");
  assert.ok(fs.existsSync(path.join(site, "index.html")), "index.html written by write_file");

  // sub-agent ran audit_website
  const results = events.filter((e) => e.type === "tool_result").map((e) => e.name);
  for (const name of ["load_skill", "generate_image", "write_file", "audit_website", "task"]) assert.ok(results.includes(name), `missing tool result ${name}`);
  const audit = events.find((e) => e.type === "tool_result" && e.name === "audit_website");
  assert.match(audit.content, /0 error/);
  assert.ok(log.systemPrompts.some((p) => p.includes("QA reviewer")), "qa-reviewer sub-agent was invoked");
});
