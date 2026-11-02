---
name: responsive-css-layout
description: Build modern responsive, mobile-first CSS layouts with CSS variables, flexbox, grid, fluid typography and a mobile navigation menu.
tags: [css, responsive, layout, mobile, grid, flexbox, design system]
tools: [generate_color_palette]
---
# Responsive CSS layout

```css
:root{--color-primary:#2457d6;--color-primary-dark:#163a96;--color-accent:#f59e0b;--color-text:#16202f;--color-muted:#5b6575;--color-surface:#f7f9fc;--radius:14px;--shadow:0 10px 30px rgba(16,24,40,.08);--maxw:1180px;--font-head:"Poppins",system-ui,sans-serif;--font-body:"Inter",system-ui,sans-serif}
*,*::before,*::after{box-sizing:border-box} body{margin:0;font-family:var(--font-body);color:var(--color-text);line-height:1.6}
img{max-width:100%;height:auto;display:block}
.container{width:min(100% - 2rem,var(--maxw));margin-inline:auto}
h1{font-size:clamp(2rem,5vw,3.5rem);line-height:1.1}
.grid{display:grid;gap:1.5rem;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.btn{display:inline-block;padding:.85rem 1.4rem;border-radius:999px;background:var(--color-primary-dark);color:#fff;text-decoration:none;font-weight:600}
.site-header{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.9);backdrop-filter:blur(8px)}
.nav-toggle{display:none} @media (max-width:820px){.nav-toggle{display:block}.nav-links{display:none;flex-direction:column}.nav-links.open{display:flex}}
.hero{display:grid;grid-template-columns:1.1fr 1fr;gap:2rem;align-items:center;padding-block:clamp(3rem,8vw,6rem)} @media (max-width:820px){.hero{grid-template-columns:1fr}}
```
- Load Google Fonts with `<link rel="preconnect">` + display=swap, or use system fonts.
- Mobile menu JS: toggle `.open` + `aria-expanded` on the button.
- Sections: `padding-block: clamp(3rem, 8vw, 6rem)`; alternate surface backgrounds.
- Use the brand palette (generate_color_palette gives accessible variants).
