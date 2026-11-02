// Unit tests for the parts that don't need an LLM: skill retrieval, frontmatter parsing,
// dynamic registration, palette & site audit. Run: npm test  (builds first)
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SkillRegistry, parseFrontmatter } = require("../dist/skills/skill-registry");
const { scanConversation } = require("../dist/agent/conversation-scan");
const { buildPalette, auditSite, contrastRatio } = require("../dist/tools/web-utils");

const skillsDir = path.join(__dirname, "..", "skills");

test("frontmatter parsing (inline lists, block lists)", () => {
  const { data, body } = parseFrontmatter("---\nname: x\ndescription: d\ntags: [a, b]\ntools:\n  - generate_image\n---\n# Body");
  assert.equal(data.name, "x");
  assert.deepEqual(data.tags, ["a", "b"]);
  assert.deepEqual(data.tools, ["generate_image"]);
  assert.equal(body.trim(), "# Body");
});

test("skill retrieval returns only the relevant skills", async () => {
  const r = new SkillRegistry(skillsDir, fs.mkdtempSync(path.join(os.tmpdir(), "c")));
  r.load();
  assert.ok(r.size >= 12);
  assert.equal((await r.search("prompts for hero images", 3))[0].name, "image-prompting-sdxl");
  assert.equal((await r.search("legal notice and GDPR privacy policy", 3))[0].name, "legal-pages-eu");
  assert.deepEqual(r.get("image-prompting-sdxl").tools, ["generate_image"]);
});

test("dynamic skill registration is searchable immediately", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skills"));
  const r = new SkillRegistry(dir, fs.mkdtempSync(path.join(os.tmpdir(), "c")));
  r.load();
  assert.equal(r.size, 0);
  r.register({ name: "Restaurant Menu Page", description: "Design a restaurant menu page with dishes and prices", body: "# Menu", tags: ["food"] });
  assert.equal(r.size, 1);
  assert.equal((await r.search("restaurant menu", 1))[0].name, "restaurant-menu-page");
});

test("conversation scan finds loaded skills and enabled tools", () => {
  const s = scanConversation([
    { type: "human", content: [{ type: "text", text: "build my site" }, { type: "image_url", image_url: { url: "data:" } }] },
    { type: "ai", content: "", tool_calls: [{ name: "load_skill", args: { name: "seo-on-page" } }, { name: "enable_tools", args: { names: ["wikipedia_summary"] } }] },
  ]);
  assert.deepEqual(s.loadedSkills, ["seo-on-page"]);
  assert.deepEqual(s.enabledTools, ["wikipedia_summary"]);
  assert.equal(s.lastUserText, "build my site");
});

test("palette is accessible", () => {
  const p = buildPalette({ base: "#1d4ed8" });
  assert.ok(contrastRatio("#ffffff", p.palette.primaryDark) >= 4.5);
  assert.match(p.css, /--color-primary-dark/);
});

test("site audit detects broken assets and missing alt", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site"));
  fs.writeFileSync(path.join(dir, "index.html"), '<!DOCTYPE html><html lang="fr"><head><meta name="viewport" content="width=device-width"><title>T</title><meta name="description" content="d"></head><body><h1>x</h1><img src="assets/missing.png"></body></html>');
  const r = auditSite(dir);
  assert.ok(r.issues.some((i) => /broken/.test(i.message)));
  assert.ok(r.issues.some((i) => /alt/.test(i.message)));
});
