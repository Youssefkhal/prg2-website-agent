---
name: seo-on-page
description: On-page SEO for corporate websites: titles, meta descriptions, headings, structured data (Organization / LocalBusiness), Open Graph, sitemap.
tags: [seo, referencement, meta, schema, google, open graph]
tools: [audit_website]
---
# On-page SEO
- `<title>`: Primary keyword – Brand (≤ 60 chars), unique per page.
- Meta description 120-160 chars with a benefit + CTA.
- One H1 containing the main keyword; H2 for sections.
- URLs/files: lowercase, hyphens (services.html, a-propos.html).
- Open Graph: og:title, og:description, og:image (hero image), og:type=website.
- JSON-LD in the home page:
```html
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"…","url":"…","logo":"assets/uploads/logo.png","contactPoint":{"@type":"ContactPoint","telephone":"…","contactType":"customer service"}}</script>
```
  Use LocalBusiness with address/openingHours for local businesses.
- Images: descriptive file names + alt, width/height attributes, loading="lazy" below the fold.
- Add /site/robots.txt and /site/sitemap.xml listing all pages.
