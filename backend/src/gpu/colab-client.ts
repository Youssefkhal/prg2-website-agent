import { config } from "../config";

/**
 * Client for the GPU server running on Google Colab (T4).
 * Every GPU computation of the project (image generation, embeddings) goes through here.
 */
export interface GenerateImageParams {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  guidance_scale?: number;
  seed?: number;
}

export interface GeneratedImage {
  png: Buffer;
  seed: number;
  width: number;
  height: number;
  elapsed_s: number;
}

export class ColabGpuClient {
  constructor(
    private readonly baseUrl = config.colabUrl,
    private readonly token = config.colabToken.trim(),
  ) {}

  get configured(): boolean {
    return !!this.baseUrl;
  }

  private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    if (!this.baseUrl) throw new Error("COLAB_GPU_URL is not set (start colab/gpu_server.ipynb on a T4 runtime)");
    if (/[^\x21-\x7e]/.test(this.token))
      throw new Error("COLAB_GPU_TOKEN contains invalid characters (it looks truncated, e.g. ends or starts with '…'): copy the full value printed by the notebook");
    const res = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Colab GPU ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }

  async health(): Promise<Record<string, unknown>> {
    if (!this.baseUrl) return { ok: false, reason: "COLAB_GPU_URL not set" };
    try {
      const res = await fetch(this.baseUrl + "/health", { signal: AbortSignal.timeout(8000) });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : { ok: false, reason: `HTTP ${res.status}` };
    } catch (e: any) {
      return { ok: false, reason: e?.message ?? String(e) };
    }
  }

  async generateImage(p: GenerateImageParams): Promise<GeneratedImage> {
    const r = await this.post<{ image_base64: string; seed: number; width: number; height: number; elapsed_s: number }>(
      "/generate",
      p,
      180_000,
    );
    return { png: Buffer.from(r.image_base64, "base64"), seed: r.seed, width: r.width, height: r.height, elapsed_s: r.elapsed_s };
  }

  async embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 256) {
      const r = await this.post<{ embeddings: number[][] }>("/embed", { texts: texts.slice(i, i + 256), kind }, 120_000);
      out.push(...r.embeddings);
    }
    return out;
  }
}

export const colab = new ColabGpuClient();
