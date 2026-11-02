import * as fs from "node:fs";
import * as path from "node:path";
import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { AgentService, type ImageInput } from "../agent/agent.service";
import { config } from "../config";
import { colab } from "../gpu/colab-client";
import { RegistryService } from "../registry/registry.service";
import { sanitizeThreadId } from "../run-context";

interface ChatBody {
  threadId: string;
  message?: string;
  images?: ImageInput[];
}

@Controller("api")
export class ApiController {
  constructor(
    @Inject(AgentService) private readonly agent: AgentService,
    @Inject(RegistryService) private readonly registry: RegistryService,
  ) {}

  @Get("health")
  async health() {
    return {
      model: config.model,
      subagentModel: config.subagentModel ?? config.model,
      gpu: await colab.health(),
      skills: { count: this.registry.skills.size, semanticIndex: this.registry.skills.semantic },
      tools: this.registry.tools.list().map((t) => t.name),
    };
  }

  /** Streams agent events as Server-Sent Events. */
  @Post("chat")
  async chat(@Body() body: ChatBody, @Res() res: Response) {
    if (!body?.threadId) throw new BadRequestException("threadId is required");
    if (!body.message?.trim() && !body.images?.length) throw new BadRequestException("message or images required");
    const images = (body.images ?? []).slice(0, 8);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    try {
      for await (const ev of this.agent.chat(body.threadId, body.message ?? "", images)) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } finally {
      clearInterval(ping);
      res.end();
    }
  }

  @Get("projects/:id/history")
  history(@Param("id") id: string) {
    return this.agent.history(id);
  }

  @Get("projects/:id/files")
  files(@Param("id") id: string) {
    const dir = path.join(config.workspaceDir, sanitizeThreadId(id));
    if (!fs.existsSync(dir)) return [];
    const out: { path: string; size: number; mtime: number }[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else {
          const st = fs.statSync(p);
          out.push({ path: "/" + path.relative(dir, p).split(path.sep).join("/"), size: st.size, mtime: st.mtimeMs });
        }
      }
    };
    walk(dir);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  @Get("projects/:id/file")
  file(@Param("id") id: string, @Query("path") p: string) {
    const dir = path.join(config.workspaceDir, sanitizeThreadId(id));
    const full = path.resolve(dir, String(p ?? "").replace(/^\/+/, ""));
    if (!full.startsWith(dir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) throw new NotFoundException();
    return { path: p, content: fs.readFileSync(full, "utf8").slice(0, 200_000) };
  }

  /* --------------------------------------------- skills: search + dynamic registration */

  @Get("skills")
  async skills(@Query("q") q?: string, @Query("k") k?: string) {
    const n = Math.min(50, Number(k ?? 10) || 10);
    const items = q ? await this.registry.skills.search(q, n) : this.registry.skills.list().slice(0, n);
    return { total: this.registry.skills.size, items: items.map(({ path: _p, hash: _h, ...s }) => s) };
  }

  @Post("skills")
  registerSkill(@Body() b: { name: string; description: string; body: string; tags?: string[]; tools?: string[] }) {
    try {
      const { path: _p, hash: _h, ...s } = this.registry.skills.register(b);
      return { registered: s, total: this.registry.skills.size };
    } catch (e: any) {
      throw new BadRequestException(e?.message);
    }
  }

  /* ---------------------------------------------- tools: list + dynamic registration */

  @Get("tools")
  tools(@Query("q") q?: string) {
    const list = q ? this.registry.tools.search(q, 10) : this.registry.tools.list();
    return list.map((t) => ({ name: t.name, description: t.description, tags: t.tags, source: t.source }));
  }

  @Post("tools")
  registerTool(@Body() manifest: any) {
    try {
      const t = this.registry.tools.registerManifest(manifest);
      return { registered: { name: t.name, description: t.description, source: t.source } };
    } catch (e: any) {
      throw new BadRequestException(e?.message);
    }
  }
}
