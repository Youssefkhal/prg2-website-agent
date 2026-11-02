/**
 * Small dependency-free BM25 index (CPU). Used for skill / tool retrieval so that
 * thousands of entries can be searched without putting them in the model context.
 * Semantic (GPU) embeddings from Colab are blended in when available.
 */

const STOPWORDS = new Set(
  (
    "a an the and or of to in on for with by from at as is are be this that it its into how what when use using " +
    "le la les un une des du de et ou en au aux pour par sur dans avec est sont ce cette ces qui que quoi comment je tu il nous vous ils site"
  ).split(" "),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalize(text).split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/** Very light stemmer (EN + FR plurals / common suffixes) — good enough for ranking. */
function stem(w: string): string {
  if (w.length > 5) {
    for (const suf of ["ations", "ation", "ements", "ement", "ings", "ing", "ies", "es", "s"]) {
      if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
    }
  } else if (w.length > 3 && w.endsWith("s")) {
    return w.slice(0, -1);
  }
  return w;
}

export interface Bm25Doc {
  id: string;
  text: string;
  /** Optional boost for fields such as the name (text repeated weight times). */
  boostText?: string;
}

export class Bm25Index {
  private docs: { id: string; len: number; tf: Map<string, number> }[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;

  constructor(
    private readonly k1 = 1.4,
    private readonly b = 0.75,
  ) {}

  build(docs: Bm25Doc[]): void {
    this.docs = [];
    this.df = new Map();
    let total = 0;
    for (const d of docs) {
      const tokens = [...tokenize(d.text), ...tokenize(d.boostText ?? ""), ...tokenize(d.boostText ?? "")];
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, len: tokens.length, tf });
      total += tokens.length;
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, k = 10): { id: string; score: number }[] {
    const q = [...new Set(tokenize(query))];
    if (!q.length || !this.docs.length) return [];
    const N = this.docs.length;
    const scored: { id: string; score: number }[] = [];
    for (const d of this.docs) {
      let s = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.len) / (this.avgLen || 1)));
      }
      if (s > 0) scored.push({ id: d.id, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
