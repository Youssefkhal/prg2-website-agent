---
name: web-accessibility-wcag
description: Make websites accessible (WCAG 2.2 AA): semantic HTML, alt text, contrast, keyboard navigation, ARIA for menus and forms.
tags: [accessibility, a11y, wcag, aria, alt, contrast, accessibilite]
tools: [audit_website]
---
# Accessibility checklist (WCAG 2.2 AA)
- `<html lang="en">` (the site language), landmarks: header, nav, main, footer; one h1, logical h2/h3 order.
- Skip link: `<a class="skip" href="#main">Skip to content</a>`.
- Every `<img>` has alt (decorative: alt=""). Describe purpose, not "image of".
- Contrast ≥ 4.5:1 body text, ≥ 3:1 large text & UI. White on mid-tone primary often fails → use darker shade.
- Focus visible: `:focus-visible{outline:3px solid var(--color-accent);outline-offset:3px}`.
- Mobile menu button: `<button aria-expanded="false" aria-controls="menu">`.
- Forms: `<label for>` for every field, required marked, error text associated with aria-describedby.
- Links say where they go ("Explore our services", not "click here").
- Respect `prefers-reduced-motion`.
Run audit_website at the end.
