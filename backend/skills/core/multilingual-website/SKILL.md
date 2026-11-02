---
name: multilingual-website
description: Build a bilingual / multilingual static website (e.g. French + English) with language switcher, hreflang and translated copy.
tags: [multilingual, translation, bilingual, english, french, i18n, langue]
---
# Multilingual static site
- Structure: /site/ (default language) + /site/en/ (same file names). Assets shared via ../assets/.
- Language switcher in header linking to the same page in the other language.
- `<html lang>` per page + `<link rel="alternate" hreflang="fr" href="…">` / `hreflang="en"` / `x-default`.
- Translate meaning, not words; adapt CTAs and legal pages (legal pages stay in the company's country language at minimum).
