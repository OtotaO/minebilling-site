# minebilling-site

Static marketing site + free tools for MineBilling (AI-assisted, human-signed
medical billing for primary-care clinics). Plain HTML/CSS/JS, no build step.

- `index.html` — landing page (free-scorecard CTA)
- `tools/em-calculator.html` — free 2021 E/M office-visit level calculator
  (99202–99215, time + MDM bases, AMA/CMS sources cited inline)
- `tools/npi-validator.html` — free in-browser NPI checksum validator

Deployed via GitHub Pages from `main`:
https://ototao.github.io/minebilling-site/

When pointing minebilling.com here: add a `CNAME` file containing the domain,
set the DNS (CNAME `www` → `ototao.github.io`, apex A records per GitHub Pages
docs), and update the canonical URLs + sitemap.
