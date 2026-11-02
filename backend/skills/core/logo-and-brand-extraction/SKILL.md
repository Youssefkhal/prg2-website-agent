---
name: logo-and-brand-extraction
description: Analyse an uploaded logo or brand image: extract colours (hex), typography style, mood, and turn them into a brand style guide for the website.
tags: [logo, brand, identity, colors, charte graphique, moodboard, image analysis, vision]
tools: [generate_color_palette]
---
# From uploaded images to a brand style guide
1. Look at the image: dominant colours (estimate hex for 1 primary, 1 secondary, 1 accent), light/dark background usage.
2. Typography cues: geometric sans (Poppins/Montserrat), humanist (Inter/Source Sans), serif (Playfair/Lora) → pick a heading + body pair.
3. Mood: 3 adjectives (e.g. premium, technical, friendly).
4. Call generate_color_palette with base = primary hex → accessible palette + CSS variables.
5. Write all of it into /brief.md under "## Brand" so sub-agents (who can't see images) can use it.
6. Use the original logo file (/site/assets/uploads/…) in header and footer, height 36-48px, alt="<Company> – logo".
7. Photos uploaded by the user (team, premises, products) are better than generated ones: use them first.
