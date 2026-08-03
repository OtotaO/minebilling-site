# minebilling-site

Static marketing site + free tools for MineBilling (AI-assisted, human-signed
medical billing for primary-care clinics). Plain HTML/CSS/JS, no build step.

## Pages

- `index.html` — landing page (free-scorecard CTA)
- `request.html` — free-scorecard request form; composes a `mailto:` and also shows
  the message as copyable text, so a machine with no registered mail handler does not
  lose the lead
- `tools/em-calculator.html` — free 2021 E/M office-visit level calculator
  (99202–99215, time + MDM bases, AMA/CMS sources cited inline)
- `tools/denial-codes.html` — CARC/RARC denial-code lookup
- `tools/timely-filing.html` — timely filing deadline calculator by payer
- `tools/em-mix.html` — E/M visit-mix self-check
- `tools/npi-validator.html` — free in-browser NPI checksum validator

All seven are listed in `sitemap.xml` and cross-linked from the `nav.toolbar` row.

## Where the data comes from — read this before changing a code, limit or fact

Three of the tools embed data that is a **copy of files in the medcode repo**. There is
no generator script checked in on either side, so a correction applied to one copy does
**not** reach the other. That is how a fact gets fixed in one place only.

| Site file | Upstream source of truth |
| --- | --- |
| `tools/denial-codes.html` (`DENIAL_CODES` array + the static `.qa` cards) | `medcode/tools/scorecard/data/denial_codes.json` |
| `tools/timely-filing.html` (`PAYERS` array + the limits table) | `medcode/tools/scorecard/data/timely_filing.json` |
| `tools/em-mix.html` (benchmark figures) | `medcode/tools/scorecard/data/em_benchmarks.json` |

When you change a coding, billing, payer or regulatory fact:

1. Change it in the medcode JSON **and** in the page here, in the same working session.
2. Cite the primary source (AMA, CMS, X12, or the payer's own published policy) in the
   commit message, with the URL you actually fetched.
3. Never alter text quoted verbatim from X12 or CMS. Only the authored plain-English
   line, the "typical next step" and the category are ours — the pages say so, and that
   claim has to stay true.
4. If a fact cannot be verified against a primary source, leave it and flag it. A
   flagged gap is fine; an invented rule is not.

Known divergence as of 2026-07-31: the CARC 45 plain-English line and next step were
corrected here (they told the clinic to write off what may be a PR — patient
responsibility — balance). The medcode copy still carries the old wording.

## Tests

No framework and no dependencies — `node:test` only:

```
node --test 'tests/*.test.mjs'
```

`tests/pages.test.mjs` drives the real pages in Chromium through Playwright to check
mobile overflow, heading structure, live-region announcements and control contrast. If
Playwright is not resolvable it **skips** rather than fails, so the rest of the suite
still runs on a bare checkout. `tests/measure.mjs` is an ad-hoc viewport-overflow
printer, not part of the suite:

```
node tests/measure.mjs 320 360 768
```

`tests/load-core.mjs` evaluates the `==BEGIN CORE==` / `==END CORE==` blocks in
`tools/timely-filing.html` and `request.html` in a `vm` context, so the filing-deadline
arithmetic and the mail composer can be tested without a browser. Keep new logic inside
those markers, and keep DOM access out of them.

## Deployment

Deployed via GitHub Pages from `main`:
https://ototao.github.io/minebilling-site/

When pointing minebilling.com here: add a `CNAME` file containing the domain,
set the DNS (CNAME `www` → `ototao.github.io`, apex A records per GitHub Pages
docs), and update the canonical URLs, the `og:url` tags and the sitemap.
