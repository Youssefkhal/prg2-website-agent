---
name: image-prompting-sdxl
description: Write effective prompts for SDXL / SDXL-Turbo text-to-image generation of photorealistic corporate website images (hero, team, office, products).
tags: [image, prompt, sdxl, stable diffusion, photo, visual, generation, illustration]
tools: [generate_image]
---
# Prompting SDXL-Turbo (Colab T4) for website imagery

SDXL-Turbo: 1-4 steps, guidance 0, best at 512-1024 px, multiples of 64. It does NOT follow negative prompts at guidance 0 → put exclusions in the prompt wording.

## Prompt structure (English, comma-separated)
`[subject + action], [setting], [composition/framing], [lighting], [camera/lens], [style], [colour palette], [quality words]`

Example hero (consulting firm, navy brand):
"diverse team of consultants discussing around a glass table in a bright modern office, wide shot, rule of thirds with empty space on the left for text, soft natural window light, 35mm lens, shallow depth of field, editorial corporate photography, navy blue and warm white tones, high detail, realistic"

## Sizes
- Hero: 1024x576 (16:9) — leave negative space for the headline
- Section cards: 768x512
- Portraits / team: 512x640
- Square icons-like visuals: 640x640

## Rules
- Consistent style keywords across the whole site (same lighting + palette words).
- Avoid text, logos, signs, screens with UI ("blank screen" if needed): models garble text.
- Hands and faces: prefer medium/wide shots, people seen from the side or back.
- Products: "studio product shot on seamless background, softbox lighting".
- Abstract/tech: "abstract 3d render, flowing glass shapes, gradient, minimal".
- Name files by placement: hero-home, about-team, service-audit…
