/**
 * Headless run of the agent (no web UI): sends a brief (+ optional images) and copies the
 * generated website to an output folder. Used by the "Generate demo site" GitHub workflow.
 *
 *   node dist/cli/demo.js --brief ../demo/brief-prompt.md --images ../demo/inputs --out ../demo/agent-run
 */
import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { AgentService } from "../agent/agent.service";
import { config } from "../config";
import { RegistryService } from "../registry/registry.service";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const briefFile = arg("brief");
  const brief = briefFile ? fs.readFileSync(briefFile, "utf8") : arg("message");
  if (!brief) throw new Error("usage: demo --brief <file.md> [--images <dir>] [--out <dir>] [--thread <id>]");
  const threadId = arg("thread", "demo")!;
  const out = path.resolve(arg("out", "demo-output")!);

  const images: { name: string; dataUrl: string }[] = [];
  const imgDir = arg("images");
  if (imgDir && fs.existsSync(imgDir)) {
    for (const f of fs.readdirSync(imgDir)) {
      const ext = path.extname(f).slice(1).toLowerCase();
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" }[ext];
      if (!mime) continue;
      images.push({ name: path.parse(f).name, dataUrl: `data:${mime};base64,${fs.readFileSync(path.join(imgDir, f)).toString("base64")}` });
    }
  }

  const registry = new RegistryService();
  registry.onModuleInit();
  await registry.skills.indexSemantic();
  const agent = new AgentService(registry);

  console.log(`model=${config.model} gpu=${config.colabUrl || "none (placeholder images)"} skills=${registry.skills.size} images=${images.length}`);
  let current = "";
  for await (const ev of agent.chat(threadId, brief, images)) {
    if (ev.type === "token") {
      if (ev.agent !== current) process.stdout.write(`\n\n[${(current = ev.agent)}] `);
      process.stdout.write(ev.text);
    } else if (ev.type === "tool_call") {
      process.stdout.write(`\n  -> ${ev.agent}: ${ev.name}`);
      current = "";
    } else if (ev.type === "tool_result" && ev.name === "generate_image") {
      process.stdout.write(`\n     ${ev.content.split("\n")[0]}`);
    } else if (ev.type === "error") {
      throw new Error(ev.message);
    }
  }

  const project = path.join(config.workspaceDir, threadId);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(project, out, { recursive: true });
  console.log(`\n\nDone. Project copied to ${out}`);
  registry.onModuleDestroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
