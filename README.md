# Atelier — agent multi-agents / multimodal pour créer des sites d'entreprise

**Réponse complète : [RESPONSE.md](RESPONSE.md) · Démo : https://youssefkhal.github.io/prg2-website-agent/**

Solution au sujet `multi_agent_multimodal_collaborative_research_and_development.md`.

| Exigence | Réalisation |
|---|---|
| `deepagents` de LangChain, raisonnement étendu | `createDeepAgent` (deepagents JS) : planification `write_todos`, système de fichiers, sous-agents `task`, checkpointer LangGraph |
| TypeScript + NestJS | `backend/` : NestJS 11, TypeScript |
| Interface web | `backend/public/` : chat en streaming (SSE), pièces jointes images, aperçu live du site, fichiers, plan, skills/outils |
| Invocation de skills, d'outils, de sous-agents | outils `search_skills` / `load_skill`, outils dynamiques (`generate_image`, `generate_color_palette`, `audit_website`, outils HTTP), 4 sous-agents : `copywriter`, `image-designer`, `web-developer`, `qa-reviewer` |
| Enregistrement **dynamique** des outils et skills (1000 skills → seuls les utiles en contexte) | `DynamicContextMiddleware` : à chaque appel du modèle, seuls 4 skills pertinents (nom + 1 ligne) sont suggérés, les skills chargés restent, et seuls les outils requis sont liés au modèle. Recherche hybride BM25 + embeddings calculés sur le GPU Colab. Ajout à chaud : dossier `skills/…/SKILL.md`, `POST /api/skills`, manifeste JSON dans `tools/` ou `POST /api/tools` |
| Multimodal (images + texte en entrée) | les images (logo, photos, moodboard) sont envoyées au modèle multimodal et enregistrées dans le projet pour être réutilisées dans le site |
| Livrable : créer un site d'entreprise, texte + images | le site statique est écrit dans `backend/workspace/<projet>/site/`, les images générées par SDXL-Turbo sur Colab T4 |
| Calculs GPU sur Colab T4 | `colab/gpu_server.ipynb` : génération d'images + embeddings, exposés par tunnel Cloudflare |

## Architecture

```
 Navigateur (public/)  ──SSE──▶  NestJS  ApiController
                                   │
                                   ▼
                        AgentService ─ createDeepAgent("atelier")
                          │   middleware: DynamicContextMiddleware
                          │      ├─ SkillRegistry  (skills/**/SKILL.md, BM25 + embeddings GPU)
                          │      └─ ToolRegistry   (outils intégrés + manifestes HTTP)
                          │   backend: FilesystemBackend → workspace/<projet>/
                          └─ sous-agents (task) : copywriter · image-designer · web-developer · qa-reviewer
                                   │
                         HTTPS (tunnel Cloudflare)
                                   ▼
                Google Colab T4 : FastAPI  /generate (SDXL-Turbo fp16)  /embed (multilingual-e5-small)
```

Déroulé type : l'agent principal analyse le brief et les images (couleurs, style), écrit `/brief.md`, charge les skills utiles, puis délègue : rédaction → `/content/*.md`, images → `/site/assets/images/*.png` (GPU), intégration → `/site/*.html` + `css/` + `js/`, puis audit SEO / accessibilité / liens cassés et corrections.

## Démarrage

### 1. GPU sur Colab (T4)
1. Ouvrir `colab/gpu_server.ipynb` dans Google Colab, **Exécution > Modifier le type d'exécution > GPU T4**.
2. Exécuter les cellules. La cellule « Démarrage » affiche `COLAB_GPU_URL=…` et `COLAB_GPU_TOKEN=…`.
3. Laisser l'onglet ouvert (la dernière cellule garde la session active). Si la session redémarre, l'URL change : mettre à jour `.env`.

Sans Colab, tout fonctionne quand même : les images sont remplacées par des SVG de substitution et la recherche de skills utilise BM25 seul.

### 2. Backend + interface (Node ≥ 20)
```bash
cd backend
npm install
cp .env.example .env        # puis renseigner ANTHROPIC_API_KEY (ou OPENAI_*) et les 2 lignes COLAB_*
npm run skills:demo         # optionnel : ajoute 1000 skills factices pour tester le passage à l'échelle
npm run build && npm start  # → http://localhost:3000
npm test                    # tests unitaires (recherche de skills, enregistrement dynamique, audit…)
```

Sous Windows (PowerShell) : `copy .env.example .env`.

## API
- `POST /api/chat` `{threadId, message, images:[{name,dataUrl}]}` → flux SSE (`token`, `tool_call`, `tool_args`, `tool_result`, `done`, `error`) — chaque événement indique l'agent (principal ou sous-agent)
- `GET /api/health` — modèle, état du GPU Colab, nombre de skills
- `GET /api/skills?q=…` · `POST /api/skills {name, description, body, tags?, tools?}`
- `GET /api/tools` · `POST /api/tools` (manifeste HTTP, voir `tools/wikipedia_summary.json`)
- `GET /api/projects/:id/files` · `GET /api/projects/:id/file?path=` · `GET /api/projects/:id/history`
- `GET /projects/:id/site/index.html` — aperçu du site généré

## Format d'un skill
```markdown
---
name: image-prompting-sdxl
description: Une phrase qui dit quand l'utiliser (c'est ce qui est indexé)
tags: [image, prompt, sdxl]
tools: [generate_image]     # outils dynamiques activés quand le skill est chargé
---
# Instructions…
```

## Limites connues
- L'historique des conversations est en mémoire (`MemorySaver`) : il est perdu au redémarrage du backend, mais les fichiers du site restent dans `workspace/`.
- SDXL-Turbo ne sait pas écrire de texte dans les images : le vrai logo envoyé par l'utilisateur est réutilisé tel quel. La licence de SDXL-Turbo est non commerciale ; pour un usage commercial, changer `IMAGE_MODEL_ID` dans le notebook.
- Les pages légales générées sont des modèles avec des champs à compléter, à faire valider par un juriste.
