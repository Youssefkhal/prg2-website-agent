# Demo — Verdance corporate website

| Folder | What it is |
|---|---|
| `brief-prompt.md` + `inputs/logo.svg` | The demo input: text brief + an image (multimodal) |
| `brief.md` | Structured brief (the agent's first artefact) |
| `site/` | The reference website, published on GitHub Pages |
| `agent-run/` | Created by the **Generate demo site with the agent** workflow: the full project produced by a real headless run of the agent (brief, content, images generated on the Colab T4, site) — published at `/agent-run/` |

The reference site in `site/` was written by hand following the exact structure and rules the agent uses (same
brief, sitemap, skills, file layout) and passes the agent's own `audit_website` tool with 0 errors / 0 warnings.
Its illustrations are hand-made SVGs because no GPU was available while building it; the agent run replaces
them with SDXL-Turbo images generated on Colab.
