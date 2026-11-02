---
name: contact-page-forms
description: Build a contact page with an accessible contact form (static site: mailto or form service), map link, opening hours and contact details.
tags: [contact, form, formulaire, map, address]
---
# Contact page
- Two columns: form (left) + contact card (right: address, phone `tel:`, email `mailto:`, hours, map link to Google/OSM).
- Static form: `<form action="mailto:contact@example.com" method="post" enctype="text/plain">` or a service placeholder (Formspree: action="https://formspree.io/f/XXXX").
- Fields: name, email (type=email, autocomplete), phone (optional), subject select, message, consent checkbox (RGPD) linking to privacy page.
- Labels visible, required fields marked, submit button with explicit text "Envoyer ma demande".
- Add JSON-LD LocalBusiness if address provided.
