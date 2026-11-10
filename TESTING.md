# Testing Atelier

This guide is for someone testing the project on their own machine.

## What you need

- **Node.js 20 or newer** and npm.
- **Git**.
- An API key for one of:
  - Anthropic — https://console.anthropic.com/
  - OpenAI — https://platform.openai.com/api-keys
  - Google Gemini — https://aistudio.google.com/apikey (free tier)
- Optional: a Google account for the **Colab T4** GPU server, needed for real generated images.

The GitHub Pages site hosts only the static UI. The **NestJS backend must run separately** on the machine that will do the work.

---

## 1. Five-minute smoke test (no model key)

```bash
git clone https://github.com/Youssefkhal/prg2-website-agent.git
cd prg2-website-agent/backend
npm install
npm test
npm start
```

Open **http://localhost:3000**.

Expected:

- the Atelier interface loads;
- the top bar shows **Colab GPU: offline**, a model pill, **12 skills** and **4 dynamic tools**;
- the **⚙ Model** button opens the settings dialog;
- the chat will not answer yet, because no model key is configured.

Useful checks:

```bash
curl http://localhost:3000/api/health
curl "http://localhost:3000/api/skills?q=hero%20image&k=3"
curl http://localhost:3000/api/tools
```

`npm test` runs the 8 unit tests and the end-to-end deep-agent test (scripted model, no API key needed).

---

## 2. Test with your own model

1. Keep the backend running (`npm start`).
2. Open **http://localhost:3000**.
3. Click **⚙ Model**.
4. Set:
   - **Backend URL:** `http://localhost:3000`
   - **Provider:** Anthropic, OpenAI-compatible, or Google Gemini
   - **Model:** for example `claude-sonnet-4-6`, `gpt-4.1`, or `gemini-2.5-flash`
   - **API key:** paste your key
   - **Base URL:** only for an OpenAI-compatible gateway (for example `https://openrouter.ai/api/v1`)
5. Click **Save & use**. The model pill should change to `provider:model`.
6. Send a brief, for example:

> Create the corporate website of Verdance, an energy-transition consultancy for SMEs in Lyon. Pages: home, services, about, contact, legal. Tone: expert, concrete, warm. Use a deep green and amber palette. Add a hero image and one image per service.

7. Optionally attach a **PNG or JPEG** logo or photo. Use PNG/JPEG rather than SVG for image understanding.

Expected during the run:

- streaming text in the chat;
- tool cards for `load_skill`, `task`, `generate_image`, `write_file`, etc.;
- sub-agent labels (`copywriter`, `image-designer`, `web-developer`, `qa-reviewer`);
- files appearing in the **Files** tab and the site in the **Preview** tab;
- the project written to `backend/workspace/<threadId>/`.

The key is kept in the backend process memory. It is not returned by the API and is not written to disk; a backend restart clears it.

### Using the GitHub Pages UI instead

Open https://youssefkhal.github.io/prg2-website-agent/ui/ and set **Backend URL** to your running backend (`http://localhost:3000`). If the backend is on another machine, use an address that machine can reach and make sure it is HTTPS for a remote setup.

If the page says **backend unreachable**, the backend is not running at the URL in Model settings. For local testing, using **http://localhost:3000** directly is the simplest option.

### Gemini free tier

If you use a Gemini free key, set this in `backend/.env` and restart the backend:

```env
MODEL_RPM=8
```

This throttles model calls to the free-tier limit. If you see `429` errors, lower it or add `MODEL_FALLBACKS`.

---

## 3. Test generated images (optional, Colab T4)

Without Colab, `generate_image` writes labelled SVG placeholders. To test real images:

1. Open `colab/gpu_server.ipynb` in Google Colab.
2. Choose **Runtime → Change runtime type → T4 GPU**.
3. Run all cells.
4. Copy the printed `COLAB_GPU_URL` and `COLAB_GPU_TOKEN` into `backend/.env`.
5. Restart the backend.
6. Run a website brief again; the image tool should save PNGs under `backend/workspace/<threadId>/site/assets/images/`.

The Colab session is temporary; the tunnel URL changes when the session restarts.

---

## 4. Test dynamic skills and tools

**Scale: 1,000 skills**

```bash
cd backend
npm run skills:demo
```

The skill registry watches the directory, so `GET /api/health` should soon show about **1,012 skills**. Start a brief and confirm from the interface that the agent still works; the middleware injects only the top few suggested skills rather than the whole catalogue.

**Register a skill at runtime**

Open **Skills & tools → Register a new skill**, fill in a name, description, tags and body, and click **Register**. Search for it immediately.

**Register a tool at runtime**

Open **Skills & tools → Dynamic tools**, paste a manifest such as:

```json
{
  "name": "wiki_lookup",
  "description": "Get the summary of a Wikipedia article",
  "method": "GET",
  "url": "https://en.wikipedia.org/api/rest_v1/page/summary/{title}",
  "parameters": {
    "type": "object",
    "properties": { "title": { "type": "string" } },
    "required": ["title"]
  }
}
```

Register it, then ask the agent to use `wiki_lookup`. The tool must first be discovered with `search_tools` and enabled with `enable_tools`, or declared by a loaded skill.

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `backend unreachable` | Backend not running, wrong Backend URL, or CORS | Start `npm start`; use `http://localhost:3000`; check `CORS_ORIGINS` |
| `401` / `invalid api key` | Wrong or expired key | Paste a fresh key in **⚙ Model** |
| `404` / model not found | Wrong model name or provider | Use a model the provider exposes; check exact spelling |
| `429` | Free-tier rate limit | Set `MODEL_RPM=8` (Gemini) or lower, restart backend |
| Images are SVG placeholders | Colab not configured | Start the Colab T4 notebook and set `COLAB_GPU_URL` / `COLAB_GPU_TOKEN` |
| Image upload not understood | SVG logo or unsupported format | Use PNG/JPEG/WebP |
| Skill/tool registration form fails | Backend error | Check the browser console and backend log |
| Generation stops early | Model quota, recursion or a provider error | Check the chat error card and backend log; retry |

---

## 6. Current status

- The UI and model/API-key settings are live.
- The committed Verdance website is a **reference output**.
- A live from-scratch generation still needs a valid model key and, for real images, an active Colab T4.
- The backend has no authentication; do not expose it publicly without putting authentication in front of it.

The response document for the requirements is [RESPONSE.md](RESPONSE.md).
