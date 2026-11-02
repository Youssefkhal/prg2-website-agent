// Generates N synthetic skills in skills/generated/ to demonstrate that the agent scales to
// thousands of skills: none of them is put in the context unless retrieved for the current task.
// Usage: node scripts/generate-demo-skills.mjs 1000
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const n = Number(process.argv[2] ?? 1000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "generated");
fs.rmSync(root, { recursive: true, force: true });

const domains = ["excel", "accounting", "hr-onboarding", "legal-contract", "python-data", "sql", "devops", "kubernetes", "marketing-email",
  "social-media", "video-editing", "podcast", "sales-crm", "customer-support", "project-management", "ux-research", "mobile-app",
  "cybersecurity", "cloud-cost", "machine-learning", "translation", "logistics", "procurement", "recruiting", "finance-reporting"];
const actions = ["audit", "template", "checklist", "automation", "best-practices", "troubleshooting", "migration", "report", "planning", "review"];
const objects = ["workflow", "dashboard", "policy", "pipeline", "campaign", "budget", "schema", "playbook", "process", "kpi"];

let count = 0;
outer: for (const d of domains) for (const a of actions) for (const o of objects) {
  if (count >= n) break outer;
  const name = `${d}-${o}-${a}`;
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"),
`---
name: ${name}
description: ${a.replace("-", " ")} for ${d.replace(/-/g, " ")} ${o}s — step-by-step procedure, pitfalls and output format.
tags: [${d}, ${o}, ${a}]
---
# ${d} ${o} ${a}
1. Clarify the goal and constraints of the ${o}.
2. Apply the ${a} procedure for ${d.replace(/-/g, " ")}.
3. Produce a concise deliverable and list open questions.
`);
  count++;
}
console.log(`generated ${count} demo skills in ${root}`);
