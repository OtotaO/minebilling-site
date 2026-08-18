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

All seven are listed in `sitemap.xml`. The `nav.toolbar` row cross-links the **five tool
pages only**, and it exists on those five pages only. `index.html` is reached from every
tool page's `header.site` brand link and its "Free scorecard" link (`../#free-look`);
`request.html` has exactly **one** inbound link in the whole site, the CTA on
`index.html`. `tests/seo.test.mjs` enforces the two invariants that are enforceable: the
sitemap lists exactly the seven URLs, and every tool page's toolbar links all five tools
with its own entry marked `aria-current="page"`.

## Where the data comes from — read this before changing a code, limit or fact

Three of the tools embed data **re-keyed by hand from files in the medcode repo**. It is
not a copy: the *facts* line up almost exactly, but the **schema is different in all three
cases**, and for two payers the **arithmetic is different too**. There is no generator
script checked in on either side, so a correction applied to one does **not** reach the
other. That is how a fact gets fixed in one place only.

| Site file | Counterpart in medcode | Relationship |
| --- | --- | --- |
| `tools/denial-codes.html` (`DENIAL_CODES` array + the static `.qa` cards) | `tools/scorecard/data/denial_codes.json` | Same 86 codes (56 CARC + 30 RARC), same wording. Schema differs: flat array with `code`/`type`/`fix`/`dates` here, vs `{source, carc:{code→entry}, rarc:{…}}` with `typical_fix`/`x12_status`/`x12_dates`/`source_url` there. |
| `tools/timely-filing.html` (`PAYERS` array + the limits table) | `tools/scorecard/data/timely_filing.json` | Same 13 payers with a verified number. **Arithmetic differs for one of them** — see below. Schema differs: this page adds `id`/`kind`/`rule`/`years`/`group`/`limit_display`/`date_label`/`date_hint`/`source_name`, medcode has `payer`/`scope`/`limit_days` and no authority field at all. medcode also carries 7 further entries whose limit is `null` (no verified number); those are deliberately absent here. |
| `tools/em-mix.html` (benchmark figures) | `tools/scorecard/data/em_benchmarks.json` | Same percentages for all six specialties, established / established-excluding-99211 / new. Schema differs: `specialties[]` keyed by `key`/`label` here, vs a flat Family-Practice block plus an `alternate_specialties` object there. This page adds `file_sha256` and `cms_verbatim`; medcode carries the raw counts, denominators and provenance this page drops. |

**The arithmetic divergence, stated exactly.** Verified 2026-08-03 against medcode
`main` at commit `e26e08a`:

- Medicare fee-for-service now **agrees**. medcode carried `"limit_days": 365` until
  OtotaO/medcode#255, which introduced an explicit `limit_rule` and moved Medicare to
  `"limit_rule": "calendar_years", "limit_years": 1` — the same reading this page uses,
  and for the same reason: 42 CFR 424.44(a)(1) is written in years, so a 2023-03-01
  service is timely through 2024-03-01, which is 366 days.
- The federal Medicaid ceiling (42 CFR 447.45(d)(1), "12 months") **still diverges**:
  `"limit_rule": "days", "limit_days": 365` in medcode, `calendar_years` here. The two
  disagree by a day across any period containing a February 29, with medcode computing
  the earlier — safer — date.
- All eleven other payers publish a day count and agree exactly.

One difference remains that is not arithmetic: medcode discloses that 42 CFR 424.44(c)
extends a deadline landing on a Federal nonworkday to the next succeeding workday, and
that it does not apply the extension. This page carries the same disclosure.

Which one is right depends on the rule's own wording, and the calendar-year reading is the
one this page can defend from the regulation. Do not "sync" the two by copying a number
across without reading the governing text first.

When you change a coding, billing, payer or regulatory fact:

1. Change it in the medcode JSON **and** in the page here, in the same working session.
2. Cite the primary source (AMA, CMS, X12, or the payer's own published policy) in the
   commit message, with the URL you actually fetched.
3. Never alter text quoted verbatim from X12 or CMS. Only the authored plain-English
   line, the "typical next step" and the category are ours — the pages say so, and that
   claim has to stay true.
4. If a fact cannot be verified against a primary source, leave it and flag it. A
   flagged gap is fine; an invented rule is not.

Resolved divergence: the CARC 45 plain-English line and next step were corrected here on
2026-07-31 (they told the clinic to write off what may be a PR — patient responsibility —
balance). That correction has since landed in medcode too (`b5d52a2`, "CARC 45: condition
the guidance on the group code (#254)"), and a field-by-field diff of all 86 codes on
2026-08-03 found zero differences in `meaning`, `plain`, `fix`/`typical_fix`, `category` or
the X12 dates. The earlier note here saying medcode "still carries the old wording" was
stale and has been removed.

## Tests

No framework. One dev dependency (Playwright), declared in `package.json`:

```
npm ci
npx playwright install chromium
npm test          # node --test 'tests/*.test.mjs'
```

**Read the skip count, not just the exit code.** `tests/pages.test.mjs` drives the real
pages in Chromium through Playwright; if Playwright is not resolvable those tests
**skip** rather than fail, so the rest of the suite still runs on a bare checkout — and
the run still exits 0. Measured on 2026-08-03 with Playwright 1.62.1 and Node 22.22.2:

| Checkout | Result | Exit code |
| --- | --- | --- |
| Playwright installed (`npm ci && npx playwright install chromium`) | 59 tests, **59 pass, 0 skipped** | 0 |
| Nothing installed | 59 tests, **52 pass, 7 skipped** | **0** — green while 7 checks never ran |
| Nothing installed, `REQUIRE_PLAYWRIGHT=1` | 59 tests, 51 pass, **1 fail**, 7 skipped | 1 |

So do not quote a pass count without saying which of those three you ran. CI
(`.github/workflows/ci.yml`) runs the middle row's failure mode out of existence: it
installs the browser, sets `REQUIRE_PLAYWRIGHT=1` so a missing dependency fails instead
of skipping, and then independently rejects the run if the TAP summary reports any
skipped test at all.

`tests/measure.mjs` is an ad-hoc viewport-overflow printer, not part of the suite:

```
node tests/measure.mjs 320 360 768
```

`tests/load-core.mjs` evaluates the `==BEGIN CORE==` / `==END CORE==` blocks in
`tools/timely-filing.html` and `request.html` in a `vm` context, so the filing-deadline
arithmetic and the mail composer can be tested without a browser. Keep new logic inside
those markers, and keep DOM access out of them.

## Deployment

Deployed via GitHub Pages from `main`:
https://minebilling.com/

When pointing minebilling.com here: add a `CNAME` file containing the domain,
set the DNS (CNAME `www` → `ototao.github.io`, apex A records per GitHub Pages
docs), and update the canonical URLs, the `og:url` tags and the sitemap.
