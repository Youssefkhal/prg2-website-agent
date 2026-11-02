import * as fs from "node:fs";
import * as path from "node:path";

/* Pure helpers used by the dynamic tools (no LangChain dependency → unit-testable). */

/* ----------------------------------------------------------------- colours */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) throw new Error(`invalid hex colour: ${hex}`);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: number[]): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function rgbToHsl([r, g, b]: number[]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function luminance(hex: string): number {
  const c = hexToRgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

const MOODS: Record<string, string> = {
  trust: "#1d4ed8", corporate: "#1e3a8a", finance: "#0f3d5e", tech: "#4f46e5", eco: "#15803d", nature: "#3f7d20",
  health: "#0d9488", energy: "#ea580c", luxury: "#7c5c2e", food: "#c2410c", creative: "#c026d3", calm: "#0e7490",
  industrial: "#374151", education: "#2563eb", legal: "#3b2f63", default: "#2457d6",
};

export function buildPalette(input: { base?: string; mood?: string }) {
  const base = input.base && /^#?[0-9a-f]{3,6}$/i.test(input.base) ? "#" + input.base.replace("#", "") : MOODS[(input.mood ?? "").toLowerCase()] ?? MOODS.default;
  const [h, s, l] = rgbToHsl(hexToRgb(base));
  const c = (hh: number, ss: number, ll: number) => rgbToHex(hslToRgb(hh, ss, ll));
  const palette = {
    primary: rgbToHex(hexToRgb(base)),
    primaryDark: c(h, s, Math.max(12, l - 18)),
    primaryLight: c(h, Math.min(90, s), 94),
    accent: c(h + 150, Math.min(85, s + 10), 52),
    neutralDark: c(h, 18, 14),
    neutral: c(h, 10, 45),
    surface: c(h, 30, 98),
    white: "#ffffff",
  };
  const text = contrastRatio(palette.neutralDark, palette.surface);
  const onPrimary = contrastRatio("#ffffff", palette.primary);
  return {
    palette,
    contrast: {
      "neutralDark on surface": text,
      "white on primary": onPrimary,
      "white on primaryDark": contrastRatio("#ffffff", palette.primaryDark),
    },
    advice:
      onPrimary < 4.5
        ? "White text on primary fails WCAG AA (4.5:1): use primaryDark for buttons with white text."
        : "White text on primary passes WCAG AA.",
    css: Object.entries(palette)
      .map(([k, v]) => `  --color-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${v};`)
      .join("\n"),
  };
}

/* ------------------------------------------------------------- site audit */

export interface AuditIssue {
  file: string;
  severity: "error" | "warning";
  message: string;
}

export function auditSite(siteDir: string): { pages: string[]; issues: AuditIssue[]; summary: string } {
  const pages: string[] = [];
  const issues: AuditIssue[] = [];
  if (!fs.existsSync(siteDir)) return { pages, issues: [{ file: "/site", severity: "error", message: "site folder does not exist" }], summary: "no site" };

  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(siteDir);
  if (!files.some((f) => path.basename(f) === "index.html" && path.dirname(f) === siteDir))
    issues.push({ file: "/site", severity: "error", message: "missing /site/index.html (home page)" });

  for (const f of files.filter((x) => x.endsWith(".html"))) {
    const rel = "/site/" + path.relative(siteDir, f).split(path.sep).join("/");
    pages.push(rel);
    const html = fs.readFileSync(f, "utf8");
    const add = (severity: AuditIssue["severity"], message: string) => issues.push({ file: rel, severity, message });

    if (!/<!doctype html>/i.test(html)) add("warning", "missing <!DOCTYPE html>");
    if (!/<html[^>]*\slang=/i.test(html)) add("warning", "<html> has no lang attribute");
    if (!/<meta[^>]+name=["']viewport/i.test(html)) add("error", "no responsive viewport meta tag");
    const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
    if (!title) add("error", "missing <title>");
    else if (title.length > 65) add("warning", `title is ${title.length} chars (aim ≤ 60)`);
    const desc = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i.exec(html)?.[1];
    if (!desc) add("warning", "missing meta description");
    else if (desc.length > 170) add("warning", `meta description is ${desc.length} chars (aim 120-160)`);
    const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (h1 !== 1) add(h1 === 0 ? "error" : "warning", `${h1} <h1> elements (expected exactly 1)`);
    for (const img of html.match(/<img\b[^>]*>/gi) ?? []) {
      if (!/\salt=/i.test(img)) add("error", `image without alt text: ${img.slice(0, 80)}`);
    }
    for (const m of html.matchAll(/\s(?:src|href)=["']([^"'#?]+)/gi)) {
      const ref = m[1];
      if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(ref)) continue;
      const target = ref.startsWith("/") ? path.join(siteDir, ref) : path.resolve(path.dirname(f), ref);
      const exists = fs.existsSync(target) || fs.existsSync(path.join(target, "index.html"));
      if (!exists) add("error", `broken local link/asset: ${ref}`);
    }
    if (/lorem ipsum/i.test(html)) add("warning", "placeholder 'lorem ipsum' text left in page");
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  return { pages, issues, summary: `${pages.length} page(s), ${errors} error(s), ${issues.length - errors} warning(s)` };
}

/* ------------------------------------------------------ placeholder image */

export function placeholderSvg(prompt: string, width: number, height: number): string {
  const hue = [...prompt].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const label = prompt.length > 70 ? prompt.slice(0, 67) + "…" : prompt;
  const esc = label.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,35%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,60%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" fill="rgba(255,255,255,.85)" font-family="sans-serif" font-size="${Math.max(12, Math.round(width / 40))}" text-anchor="middle">${esc}</text>
</svg>`;
}

export function slugify(s: string, max = 48): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max) || "image"
  );
}
