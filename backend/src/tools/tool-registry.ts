import * as fs from "node:fs";
import * as path from "node:path";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { Bm25Index } from "../retrieval/bm25";
import { colab } from "../gpu/colab-client";
import { resolveVirtual } from "../run-context";
import { auditSite, buildPalette, placeholderSvg, slugify } from "./web-utils";

/**
 * Dynamic tool registry.
 *
 * Tools here are NOT bound to the model up-front. They are executable by the agent
 * (the middleware resolves them in wrapToolCall), but their schemas only enter the
 * model context when:
 *   - a loaded skill declares them (`tools: [...]` in SKILL.md frontmatter), or
 *   - the agent enables them explicitly after `search_tools`.
 * Tools can be registered at runtime: drop a JSON manifest in backend/tools/ or POST /api/tools.
 */
export interface DynamicToolEntry {
  name: string;
  description: string;
  tags: string[];
  source: "builtin" | "manifest";
  tool: StructuredToolInterface;
}

export interface HttpToolManifest {
  name: string;
  description: string;
  method?: "GET" | "POST";
  /** URL template, e.g. https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title} */
  url: string;
  headers?: Record<string, string>;
  /** JSON Schema of the arguments (type: object). */
  parameters: Record<string, any>;
  tags?: string[];
}

/* ------------------------------------------------------------ built-in tools */

export const generateImageTool = tool(
  async ({ prompt, filename, width, height, negative_prompt, seed }) => {
    const w = width ?? 768;
    const h = height ?? 512;
    const slug = slugify(filename ?? prompt);
    if (!colab.configured) {
      const rel = `/site/assets/images/${slug}.svg`;
      const full = resolveVirtual(rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, placeholderSvg(prompt, w, h));
      return `GPU server not configured (COLAB_GPU_URL empty): wrote a placeholder ${w}x${h} SVG to ${rel}. Reference it from /site/*.html as "assets/images/${slug}.svg".`;
    }
    try {
      const img = await colab.generateImage({ prompt, negative_prompt, width: w, height: h, seed });
      const rel = `/site/assets/images/${slug}.png`;
      const full = resolveVirtual(rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, img.png);
      return `Generated on Colab T4 in ${img.elapsed_s}s (${img.width}x${img.height}, seed ${img.seed}). Saved to ${rel}. Reference it from /site/*.html as "assets/images/${slug}.png".`;
    } catch (e: any) {
      // Report the failure to the agent instead of crashing the whole run.
      return `ERROR: image generation failed on the Colab GPU server (${e?.message ?? e}). Retry once; if it fails again, continue without this image and mention it in your final summary.`;
    }
  },
  {
    name: "generate_image",
    description:
      "Generate a photo/illustration with the text-to-image model running on the Colab T4 GPU (SDXL-Turbo) and save it in the website assets. " +
      "Write rich English prompts (subject, setting, style, lighting, camera). Returns the saved path.",
    schema: z.object({
      prompt: z.string().describe("Detailed English image prompt"),
      filename: z.string().optional().describe("Short file name without extension, e.g. 'hero-office'"),
      width: z.number().int().min(256).max(1024).optional().describe("Multiple of 64. Hero: 1024x576, cards: 768x512, square: 640x640"),
      height: z.number().int().min(256).max(1024).optional(),
      negative_prompt: z.string().optional(),
      seed: z.number().int().optional(),
    }),
  },
);

const paletteTool = tool(async (input) => JSON.stringify(buildPalette(input), null, 2), {
  name: "generate_color_palette",
  description:
    "Build an accessible brand colour palette (CSS variables + WCAG contrast ratios) from a base hex colour or a mood keyword " +
    "(trust, corporate, finance, tech, eco, health, energy, luxury, food, creative, calm, industrial, education, legal).",
  schema: z.object({
    base: z.string().optional().describe("Base brand colour, e.g. #1d4ed8 (e.g. taken from the uploaded logo)"),
    mood: z.string().optional(),
  }),
});

const auditTool = tool(
  async () => {
    const report = auditSite(resolveVirtual("/site"));
    const lines = report.issues.slice(0, 80).map((i) => `- [${i.severity}] ${i.file}: ${i.message}`);
    return `Audit: ${report.summary}\nPages: ${report.pages.join(", ") || "none"}\n${lines.join("\n") || "No issues found."}`;
  },
  {
    name: "audit_website",
    description:
      "Audit the website in /site: SEO (title, meta description, single h1), accessibility (alt text, lang, viewport) and broken local links/images. Run it before declaring the site finished.",
    schema: z.object({}),
  },
);

/* --------------------------------------------------------- manifest tools */

export function httpToolFromManifest(m: HttpToolManifest): StructuredToolInterface {
  const method = (m.method ?? "GET").toUpperCase();
  return (tool as any)(
    async (args: Record<string, unknown>) => {
      const used = new Set<string>();
      const props = (m.parameters?.properties ?? {}) as Record<string, any>;
      const value = (k: string) => args[k] ?? props[k]?.default;
      const url = new URL(
        m.url.replace(/\{(\w+)\}/g, (_, k) => {
          used.add(k);
          return encodeURIComponent(String(value(k) ?? ""));
        }),
      );
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) if (!used.has(k) && v !== undefined) rest[k] = v;
      if (method === "GET") for (const [k, v] of Object.entries(rest)) url.searchParams.set(k, String(v));
      const res = await fetch(url, {
        method,
        headers: { accept: "application/json", "user-agent": "website-deep-agent/1.0", ...(method === "POST" ? { "content-type": "application/json" } : {}), ...(m.headers ?? {}) },
        body: method === "POST" ? JSON.stringify(rest) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      return `HTTP ${res.status}\n${text.slice(0, 4000)}`;
    },
    { name: m.name, description: m.description, schema: m.parameters as any },
  ) as unknown as StructuredToolInterface;
}

/* --------------------------------------------------------------- registry */

export class ToolRegistry {
  private entries = new Map<string, DynamicToolEntry>();
  private index = new Bm25Index();

  constructor(private readonly dir: string) {
    this.add({ name: "generate_image", description: generateImageTool.description, tags: ["image", "photo", "visual", "illustration", "gpu", "colab"], source: "builtin", tool: generateImageTool as any });
    this.add({ name: "generate_color_palette", description: paletteTool.description, tags: ["color", "brand", "design", "css", "accessibility"], source: "builtin", tool: paletteTool as any });
    this.add({ name: "audit_website", description: auditTool.description, tags: ["seo", "qa", "accessibility", "links", "review"], source: "builtin", tool: auditTool as any });
  }

  private add(e: DynamicToolEntry): void {
    this.entries.set(e.name, e);
    this.index.build([...this.entries.values()].map((x) => ({ id: x.name, text: x.description, boostText: `${x.name.replace(/_/g, " ")} ${x.tags.join(" ")}` })));
  }

  loadManifests(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir).filter((x) => x.endsWith(".json"))) {
      try {
        this.registerManifest(JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8")), false);
      } catch (e: any) {
        console.warn(`[tools] skipped ${f}: ${e?.message ?? e}`);
      }
    }
  }

  registerManifest(m: HttpToolManifest, persist = true): DynamicToolEntry {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(m?.name ?? "")) throw new Error("tool name must match ^[a-zA-Z0-9_-]{1,64}$");
    if (!m.description || !m.url) throw new Error("description and url are required");
    if (!/^https?:\/\//.test(m.url)) throw new Error("url must be http(s)");
    if (this.entries.get(m.name)?.source === "builtin") throw new Error(`'${m.name}' is a built-in tool`);
    const parameters = m.parameters?.type === "object" ? m.parameters : { type: "object", properties: {}, ...(m.parameters ?? {}) };
    const manifest = { ...m, parameters };
    const entry: DynamicToolEntry = { name: m.name, description: m.description, tags: m.tags ?? [], source: "manifest", tool: httpToolFromManifest(manifest) };
    this.add(entry);
    if (persist) fs.writeFileSync(path.join(this.dir, `${m.name}.json`), JSON.stringify(manifest, null, 2));
    return entry;
  }

  get(name: string): DynamicToolEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  list(): DynamicToolEntry[] {
    return [...this.entries.values()];
  }

  search(query: string, k = 5): DynamicToolEntry[] {
    const hits = this.index.search(query, k).map((h) => this.entries.get(h.id)!);
    return hits.length ? hits : this.list().slice(0, k);
  }
}
