---
name: static-site-performance
description: Keep a static website fast: image sizes, lazy loading, font loading, minimal JS, Core Web Vitals.
tags: [performance, speed, core web vitals, optimization, lazy loading]
---
# Performance
- Hero image: add width/height, fetchpriority="high", no lazy loading; others loading="lazy" decoding="async".
- Max 2 font families, 3 weights, display=swap, preconnect.
- One CSS file, one small JS file with `defer`. No frameworks for a vitrine site.
- Avoid layout shift: reserve space for images (aspect-ratio).
