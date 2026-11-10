# Response — Multi-Agent / Multi-Modal Collaborative Research and Development

**Project:** *Atelier* — a LangChain `deepagents` agent that builds a corporate website, text and images together, from a brief and reference images.
**Repository:** https://github.com/Youssefkhal/prg2-website-agent
**Live website:** https://youssefkhal.github.io/prg2-website-agent/
**Web interface:** http://localhost:3000 (served by NestJS) · GitHub Pages: https://youssefkhal.github.io/prg2-website-agent/ui/ (deployed by the Pages workflow; set the backend URL and paste your model API key in Model settings)

> **Status:** all requirements are implemented in the repository. The committed Verdance site is a **reference output**; a live run that generates the site from scratch still needs a valid model API key and an active Colab T4. The hosted UI accepts the model key in **Model settings**.

## Requirement coverage

| Requirement | Implementation | Status |
|---|---|---|
| LangChain `deepagents` for extended reasoning | `createDeepAgent` graph with virtual filesystem, sub-agents, checkpointer and recursion limit 400 | Implemented |
| TypeScript, NestJS | NestJS 11 + TypeScript 5.9 backend | Implemented |
| Python only as FastAPI | FastAPI GPU server for image generation and embeddings | Implemented |
| Web interface | Streaming chat, image attachments, live preview, files, skills/tools and model/API-key settings | Implemented |
| Skill, tool and sub-agent invocation | `search_skills` / `load_skill`, built-in and HTTP tools, four `task` sub-agents | Implemented |
| Dynamic registration of tools and skills; only needed skills in context | Per-call retrieval, progressive loading, lazy tool binding, hot registration | Implemented |
| Multimodal images + text | Image uploads saved to the project and sent as image blocks to a multimodal model | Implemented |
| Corporate website with text + images | Brief → copy → generated images → static site | Implemented; reference site included |

---

## 1. LangChain `deepagents` for extended reasoning

The agent is built with `createDeepAgent()` and the `atelier` identity ([`agent.service.ts#L61-L105`](backend/src/agent/agent.service.ts#L61-L105)):

```ts
this.agent = createDeepAgent({
  name: "atelier",
  systemPrompt: MAIN_SYSTEM_PROMPT,
  tools: [],
  middleware: mw,
  checkpointer: this.checkpointer,
  backend: () => new FilesystemBackend({
    rootDir: currentContext().projectDir,
    virtualMode: true,
  }),
  subagents: [copywriter, "image-designer", "web-developer", "qa-reviewer"],
});
```

The long-horizon capabilities come from deepagents itself:

- **Delegation.** Four specialised sub-agents are invoked through the `task` tool; they run in isolated contexts and share work through the virtual filesystem.
- **Filesystem.** The agent can list, read, write, edit, delete, glob and grep files inside the project, so it can produce `/brief.md`, `/content/*.md` and `/site/*`.
- **Memory.** A LangGraph checkpointer (`MemorySaver`) keeps the conversation state across turns.
- **Long tasks.** `recursionLimit: 400` allows the agent to keep working through planning, delegation and build steps ([`agent.service.ts#L153-L156`](backend/src/agent/agent.service.ts#L153-L156)).

The main prompt defines the workflow: analyse the brief and images → write `/brief.md` → load skills → delegate copy, images and build → verify ([`prompts.ts#L1-L30`](backend/src/agent/prompts.ts#L1-L30)).

## 2. TypeScript with NestJS

The backend is entirely TypeScript:

- NestJS 11 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`).
- TypeScript 5.9 with `strict: true` ([`tsconfig.json`](backend/tsconfig.json)).
- `AppModule`, `ApiController`, `AgentService` and `RegistryService` are Nest providers/controllers ([`main.ts`](backend/src/main.ts)).
- No second backend framework and no Python in the request path.

The web front end is plain HTML/CSS/JS served by Nest as static assets; the application framework is NestJS.

## 3. Python only as FastAPI

Python is used only for the GPU work. [`colab/gpu_server.py`](colab/gpu_server.py) is a FastAPI app with:

- `POST /generate` — SDXL-Turbo fp16 text-to-image;
- `POST /embed` — multilingual-e5-small embeddings for skill retrieval;
- `GET /health` — device, GPU name and loaded models.

The same server is started from `colab/gpu_server.ipynb` and exposed through a Cloudflare quick tunnel. The NestJS backend calls it over HTTP.

## 4. Web interface

[`backend/public/index.html`](backend/public/index.html) and [`app.js`](backend/public/app.js) provide:

- streaming chat over SSE (`token`, `tool_call`, `tool_args`, `tool_result`, `uploads`, `done`, `error`);
- image attachments by button, drag & drop and paste, with client-side downscaling;
- a live iframe preview of `/projects/<id>/site/...` with a page selector;
- a file browser/viewer for the brief, content, site and images;
- a plan panel and sub-agent activity;
- skill search, a skill registration form and an HTTP-tool registration form;
- **Model settings**: provider, model, backend URL and API key; the key is applied at runtime through `POST /api/settings` and kept in the backend process only.

The UI is served by Nest at `http://localhost:3000`, and a static copy is published at https://youssefkhal.github.io/prg2-website-agent/ui/. Because GitHub Pages cannot run Node, the Pages copy points at a separately running NestJS backend; the backend URL is configurable in Model settings (default `http://localhost:3000`).

The NestJS side serves the UI and the generated projects statically ([`main.ts#L34-L35`](backend/src/main.ts#L34-L35)). The REST surface is in [`api.controller.ts`](backend/src/api/api.controller.ts): `POST /api/chat`, `GET /api/health`, `GET|POST|DELETE /api/settings`, `GET|POST /api/skills`, `GET|POST /api/tools`, `GET /api/projects/:id/{files,file,history}`.

## 5. Skill, tool and sub-agent invocation

**Skill invocation.** The agent has `search_skills(query)` and `load_skill(name[, file])` ([`dynamic-context.middleware.ts#L41-L87`](backend/src/agent/dynamic-context.middleware.ts#L41-L87)). A skill is a folder with a `SKILL.md` in Agent-Skills format (YAML frontmatter + markdown). Twelve core skills ship in [`backend/skills/core/`](backend/skills/core/) for website architecture, copywriting, SDXL prompting, brand extraction, accessibility, SEO, legal pages, responsive layout, performance, forms, conversion and multilingual sites.

**Tool invocation.** Built-in tools ([`tool-registry.ts#L42-L105`](backend/src/tools/tool-registry.ts#L42-L105)):

- `generate_image` — calls the Colab T4 and saves a PNG; writes an SVG placeholder when no GPU is configured.
- `generate_color_palette` — builds an accessible palette from a brand colour or mood.

HTTP tools are declared as JSON manifests and executed by `httpToolFromManifest` ([`tool-registry.ts#L109-L136`](backend/src/tools/tool-registry.ts#L109-L136)).

**Sub-agent invocation.** Specialist sub-agents are declared in `createDeepAgent` and called through the `task` tool ([`agent.service.ts#L70-L104`](backend/src/agent/agent.service.ts#L70-L104)):

| Agent | Responsibility | Specific tools |
|---|---|---|
| `copywriter` | Titles, meta descriptions, headings, body, CTAs and alt texts → `/content/*.md` | skills via middleware |
| `image-designer` | Art direction, English SDXL prompts, sizes and consistent style → `/site/assets/images/` | `generate_image` |
| `web-developer` | Semantic, responsive, accessible static site in `/site` | `generate_color_palette` via skill |

## 6. Dynamic registration of tools and skills

With 1,000 local skills, the context should contain only the skills needed for the current request. That is implemented by `DynamicContextMiddleware` ([`dynamic-context.middleware.ts`](backend/src/agent/dynamic-context.middleware.ts)).

### On every model call

1. **Retrieve.** The latest user message is searched against the skill index. Only the top `AUTO_SUGGEST_SKILLS` (default 4) are injected, as `name: description`.
2. **Load on demand.** The agent calls `load_skill(name)` for the full `SKILL.md`, or `load_skill(name, file)` for a resource. Anything else goes through `search_skills(query)`.
3. **Derive state from the conversation.** Loaded skills and enabled tools are recovered by scanning the message history for `load_skill` and `enable_tools` tool calls ([`conversation-scan.ts`](backend/src/agent/conversation-scan.ts)).
4. **Bind tools lazily.** A skill declares its tools in its frontmatter (`tools: [...]`). Those tools — plus anything enabled with `search_tools` → `enable_tools` — are added to `request.tools` for that call only. No other tool schema enters the model context.
5. **Execute dynamic tools.** `wrapToolCall` supplies the implementation for tools that were not registered when the agent was created ([`dynamic-context.middleware.ts#L150-L156`](backend/src/agent/dynamic-context.middleware.ts#L150-L156)), so tools registered at runtime work without rebuilding the agent.

### Measured scale

With the 12 core skills plus 1,000 generated skills, one middleware call produced:

```
SKILLS 1012   SEMANTIC false   MIDDLEWARE_MS 4
PROMPT_ADDITION 1051 characters
Suggested for the current request:
- corporate-website-architecture
- legal-pages-eu
- seo-on-page
- image-prompting-sdxl
Dynamic tools currently bound: none.
```

None of the 1,000 generated skill names appeared in the prompt; only the four suggestions did. BM25 search over 1,012 skills took about 1 ms. The middleware binds `generate_image` only after `load_skill(image-prompting-sdxl)`.

### Runtime registration

- **Skills:** drop a folder with `SKILL.md` under `backend/skills/` (the registry watches the directory and re-indexes after about 500 ms), or call `POST /api/skills`.
- **Tools:** call `POST /api/tools` with a JSON manifest; the tool is added to the registry immediately and becomes available through `search_tools` / `enable_tools`. Manifests in `backend/tools/` are loaded at startup.
- **Scale test:** `npm run skills:demo` generates 1,000 synthetic skills in `backend/skills/generated/`.

### Retrieval

BM25 is dependency-free, with French/English normalisation and light stemming. When the GPU server is configured, skill embeddings are computed on the T4 in batches and cached on disk; queries are embedded and cached. The final score is 0.5 × normalised BM25 + 0.5 × cosine, with a BM25-only fallback when the GPU server is offline.

## 7. Multimodal support: images and text

- The UI accepts images through the attach button, drag & drop and paste, and downscales them client-side to ≤ 1568 px ([`public/app.js#L144-L171`](backend/public/app.js#L144-L171)).
- The backend saves each upload under `/site/assets/uploads/<name>.<ext>` and sends the message as one text block plus one `image_url` block per image ([`agent.service.ts#L145-L155`](backend/src/agent/agent.service.ts#L145-L155)).
- The main agent analyses the images (brand colours, style, mood, typography), writes the analysis into `/brief.md`, builds an accessible palette and reuses the uploaded logo in the site.
- The default model is multimodal; `MODEL` can be any multimodal, tool-calling LangChain model (Anthropic, OpenAI or Gemini).

## 8. Deliverable: corporate website with text and images

The agent produces a complete static corporate website:

```
/brief.md
  → /content/*.md            copy for every page
  → /site/assets/images/*    images generated on the Colab T4
  → /site/*.html + css + js  the website
```

- The **copywriter** produces the page text, meta descriptions and alt texts.
- The **image-designer** writes English SDXL prompts, generates the hero and section images with `generate_image`, and records filename, placement and alt text in `/content/images.md`.
- The **web-developer** builds the semantic, responsive static site from the brief, copy and images.

The repository includes the five-page **Verdance** corporate website in [`demo/site/`](demo/site/), published at https://youssefkhal.github.io/prg2-website-agent/: home, services, about, contact and legal pages, with hero and service images and consistent brand colours.

The live generation pipeline needs an LLM API key and the Colab T4 server; without the GPU, `generate_image` falls back to labelled SVG placeholders, so the site can still be built.

---

In short, each requirement maps to a concrete part of the repository: the deepagents graph and sub-agents, the NestJS backend, the FastAPI GPU server, the web interface, skill/tool/sub-agent invocation, the dynamic-context middleware, multimodal image input, and the website-generation pipeline with the Verdance reference output.
