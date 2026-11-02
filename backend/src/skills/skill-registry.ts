import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Bm25Index, cosine } from "../retrieval/bm25";
import type { ColabGpuClient } from "../gpu/colab-client";

/**
 * Skill library with dynamic registration.
 *
 * Skills are folders containing a SKILL.md (Agent-Skills format: YAML frontmatter
 * with name/description, markdown body). The library can hold thousands of them;
 * NONE are put in the model context by default. Instead:
 *   - the registry indexes them (BM25 on CPU + optional semantic embeddings computed on the Colab T4),
 *   - each turn only the few skills relevant to the request are suggested,
 *   - the agent calls `search_skills` / `load_skill` to pull exactly what it needs.
 * New skills can be added at runtime (drop a folder, or POST /api/skills) — the
 * index is rebuilt automatically, no restart needed.
 */
export interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
  /** Dynamic tools this skill needs: they become visible to the model once the skill is loaded. */
  tools: string[];
  path: string;
  hash: string;
}

export function parseFrontmatter(md: string): { data: Record<string, unknown>; body: string } {
  const m = /^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(md);
  if (!m) return { data: {}, body: md };
  const data: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && currentKey) {
      const arr = Array.isArray(data[currentKey]) ? (data[currentKey] as unknown[]) : [];
      arr.push(unquote(item[1]));
      data[currentKey] = arr;
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    currentKey = kv[1];
    const v = kv[2].trim();
    if (v === "") data[currentKey] = [];
    else if (v.startsWith("[") && v.endsWith("]"))
      data[currentKey] = v
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    else data[currentKey] = unquote(v);
  }
  return { data, body: md.slice(m[0].length) };
}

function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(/[\s,]+/).filter(Boolean);
  return [];
}

export class SkillRegistry {
  private skills = new Map<string, SkillMeta>();
  private bm25 = new Bm25Index();
  private embeddings = new Map<string, number[]>(); // hash -> vector (computed on Colab GPU)
  private queryCache = new Map<string, number[]>();
  private semanticReady = false;
  private watcher?: fs.FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  version = 0;

  constructor(
    private readonly dir: string,
    private readonly cacheDir: string,
    private readonly gpu?: ColabGpuClient,
  ) {}

  /* ------------------------------------------------------------------ loading */

  load(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const found = new Map<string, SkillMeta>();
    const walk = (d: string, depth: number) => {
      if (depth > 6) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.name === "SKILL.md") {
          const meta = this.readMeta(p);
          if (meta) found.set(meta.name, meta);
        }
      }
    };
    walk(this.dir, 0);
    this.skills = found;
    this.bm25.build(
      [...found.values()].map((s) => ({ id: s.name, text: `${s.description} ${s.tags.join(" ")}`, boostText: `${s.name.replace(/-/g, " ")} ${s.tags.join(" ")}` })),
    );
    this.version++;
    this.loadEmbeddingCache();
  }

  private readMeta(file: string): SkillMeta | null {
    try {
      const md = fs.readFileSync(file, "utf8");
      const { data } = parseFrontmatter(md);
      const name = String(data.name ?? path.basename(path.dirname(file))).trim();
      const description = String(data.description ?? "").trim();
      if (!name || !description) return null;
      const metadata = (data.metadata ?? {}) as Record<string, unknown>;
      return {
        name,
        description,
        tags: asList(data.tags),
        tools: [...asList(data.tools), ...asList(data["allowed-tools"]), ...asList(metadata["include_tools"])],
        path: file,
        hash: crypto.createHash("sha1").update(`${name}\n${description}\n${asList(data.tags).join(",")}`).digest("hex"),
      };
    } catch {
      return null;
    }
  }

  /** Hot reload when skill folders are added / edited / removed. */
  watch(onChange?: () => void): void {
    try {
      this.watcher = fs.watch(this.dir, { recursive: true }, () => {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.load();
          void this.indexSemantic();
          onChange?.();
        }, 500);
      });
    } catch {
      /* recursive watch unsupported on this platform: POST /api/skills still works */
    }
  }

  close(): void {
    this.watcher?.close();
  }

  /* ---------------------------------------------------------- semantic (GPU) */

  private get cacheFile(): string {
    return path.join(this.cacheDir, "skill-embeddings.json");
  }

  private loadEmbeddingCache(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile, "utf8")) as Record<string, number[]>;
      this.embeddings = new Map(Object.entries(raw));
    } catch {
      /* no cache yet */
    }
    this.semanticReady = this.skills.size > 0 && [...this.skills.values()].every((s) => this.embeddings.has(s.hash));
  }

  /** Compute missing skill embeddings on the Colab T4 (cached on disk). Safe to call often. */
  async indexSemantic(): Promise<{ embedded: number; ready: boolean }> {
    if (!this.gpu?.configured) return { embedded: 0, ready: false };
    const missing = [...this.skills.values()].filter((s) => !this.embeddings.has(s.hash));
    if (missing.length) {
      try {
        const vecs = await this.gpu.embed(
          missing.map((s) => `${s.name.replace(/-/g, " ")}: ${s.description} ${s.tags.join(" ")}`),
          "passage",
        );
        missing.forEach((s, i) => this.embeddings.set(s.hash, vecs[i]));
        fs.mkdirSync(this.cacheDir, { recursive: true });
        fs.writeFileSync(this.cacheFile, JSON.stringify(Object.fromEntries(this.embeddings)));
      } catch (e: any) {
        console.warn(`[skills] semantic indexing skipped: ${e?.message ?? e}`);
        return { embedded: 0, ready: false };
      }
    }
    this.semanticReady = this.skills.size > 0;
    return { embedded: missing.length, ready: this.semanticReady };
  }

  private async queryVector(q: string): Promise<number[] | null> {
    if (!this.semanticReady || !this.gpu?.configured) return null;
    const key = q.slice(0, 500);
    const hit = this.queryCache.get(key);
    if (hit) return hit;
    try {
      const [v] = await this.gpu.embed([key], "query");
      if (this.queryCache.size > 500) this.queryCache.clear();
      this.queryCache.set(key, v);
      return v;
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------- query */

  get size(): number {
    return this.skills.size;
  }

  get semantic(): boolean {
    return this.semanticReady;
  }

  get(name: string): SkillMeta | undefined {
    return this.skills.get(name);
  }

  list(): SkillMeta[] {
    return [...this.skills.values()];
  }

  readBody(name: string): string | null {
    const s = this.skills.get(name);
    return s ? fs.readFileSync(s.path, "utf8") : null;
  }

  /** Hybrid search: BM25 (always) blended with cosine similarity of Colab embeddings (when available). */
  async search(query: string, k = 5): Promise<(SkillMeta & { score: number })[]> {
    const lexical = this.bm25.search(query, 60);
    const maxLex = lexical[0]?.score ?? 1;
    const scores = new Map<string, number>();
    for (const r of lexical) scores.set(r.id, 0.5 * (r.score / maxLex));

    const qv = await this.queryVector(query);
    if (qv) {
      const sem: { id: string; s: number }[] = [];
      for (const s of this.skills.values()) {
        const v = this.embeddings.get(s.hash);
        if (v) sem.push({ id: s.name, s: cosine(qv, v) });
      }
      sem.sort((a, b) => b.s - a.s);
      for (const r of sem.slice(0, 60)) scores.set(r.id, (scores.get(r.id) ?? 0) + 0.5 * Math.max(0, r.s));
    } else {
      for (const [id, s] of scores) scores.set(id, s * 2);
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([id, score]) => ({ ...this.skills.get(id)!, score: Math.round(score * 1000) / 1000 }));
  }

  /* -------------------------------------------------------- dynamic register */

  register(input: { name: string; description: string; body: string; tags?: string[]; tools?: string[] }): SkillMeta {
    const name = input.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
    if (!name || !input.description) throw new Error("name and description are required");
    const dir = path.join(this.dir, "custom", name);
    fs.mkdirSync(dir, { recursive: true });
    const fm = [
      "---",
      `name: ${name}`,
      `description: ${input.description.replace(/\n/g, " ")}`,
      input.tags?.length ? `tags: [${input.tags.join(", ")}]` : null,
      input.tools?.length ? `tools: [${input.tools.join(", ")}]` : null,
      "---",
      "",
    ]
      .filter((l) => l !== null)
      .join("\n");
    fs.writeFileSync(path.join(dir, "SKILL.md"), fm + input.body.trim() + "\n");
    this.load();
    void this.indexSemantic();
    return this.skills.get(name)!;
  }
}
