/* Regression tests for tools/denial-codes.html.

   Primary sources verified 2026-07-31:
   - X12 CARC 45 (https://x12.org/codes/claim-adjustment-reason-codes):
     "Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement.
      Usage: ... (Use only with Group Codes PR or CO depending upon liability)"
   - CMS Pub 100-04 Ch.22 §60.1
     (https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/clm104c22.pdf):
     "CO - Contractual Obligations. This group code shall be used when a contractual
      agreement between the payer and payee, or a regulatory requirement, resulted in an
      adjustment. Generally, these adjustments are considered a write off for the provider
      and are not billed to the patient."
     "PR - Patient Responsibility. This group code shall be used when the adjustment
      represent an amount that may be billed to the patient or insured. This group would
      typically be used for deductible and copay adjustments."
   So CARC 45 cannot be described as a write-off unconditionally: on a PR-45 line the money
   may be billable to the patient.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(import.meta.dirname, "../tools/denial-codes.html");
const html = fs.readFileSync(FILE, "utf8");

function denialCodes() {
  const i = html.indexOf("DENIAL_CODES = [");
  const j = html.indexOf("];", i);
  assert.notEqual(i, -1, "DENIAL_CODES array not found");
  return JSON.parse(html.slice(i + "DENIAL_CODES = ".length, j + 1));
}

const CODES = denialCodes();
const ALIASES = CODES.filter((e) => e.base);
const DISTINCT = CODES.filter((e) => !e.base);

test("the embedded code table still parses and still carries the alias entries", () => {
  assert.equal(CODES.length, 89);
  assert.equal(ALIASES.length, 4);
  assert.equal(DISTINCT.length, 85);
  assert.deepEqual(ALIASES.map((e) => e.code).sort(), ["CO-4", "PR-1", "PR-2", "PR-3"]);
  // every alias points at a code that is itself present
  for (const a of ALIASES) {
    assert.ok(DISTINCT.some((e) => e.code === a.base), `${a.code} -> ${a.base} has no base entry`);
  }
});

/* ---- A5-03: CARC 45 must not tell a clinic to write off a PR line ---- */

test("A5-03: CARC 45 keeps the verbatim X12 text", () => {
  const e = CODES.find((c) => c.code === "45");
  assert.ok(e, "CARC 45 missing");
  assert.equal(
    e.meaning,
    "Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement. " +
      "Usage: This adjustment amount cannot equal the total service or claim charge amount; and " +
      "must not duplicate provider adjustment amounts (payments and contractual reductions) that " +
      "have resulted from prior payer(s) adjudication. (Use only with Group Codes PR or CO " +
      "depending upon liability)"
  );
});

test("A5-03: CARC 45's plain text and next step are conditioned on the group code", () => {
  const e = CODES.find((c) => c.code === "45");
  // must not assert a write-off unconditionally
  assert.doesNotMatch(
    e.plain,
    /The difference is a contractual write-off, not a denial\./,
    "CARC 45 still claims the amount is always a contractual write-off"
  );
  for (const field of ["plain", "fix"]) {
    assert.match(e[field], /\bCO\b/, `CARC 45 ${field} should name group code CO`);
    assert.match(e[field], /\bPR\b/, `CARC 45 ${field} should name group code PR`);
  }
  assert.match(e.plain, /patient responsibility/i);
  assert.match(e.fix, /confirm before billing/i);
});

test("A5-03: the static CARC 45 card matches the data entry", () => {
  const e = CODES.find((c) => c.code === "45");
  const idx = html.indexOf('id="code-45"');
  assert.notEqual(idx, -1, "static CARC 45 block missing");
  const block = html.slice(idx, idx + 1600);
  const decoded = block.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
  assert.ok(decoded.includes(e.plain), "static h3 text has drifted from the DENIAL_CODES plain text");
  assert.ok(decoded.includes(e.fix), "static next-step text has drifted from the DENIAL_CODES fix text");
});

/* ---- A5-09: the advertised count matches the data ---- */

test("A5-09: the page advertises the distinct-code count, not the row count", () => {
  assert.ok(html.includes("Show all " + DISTINCT.length + " codes"), "chip label count is wrong");
  assert.ok(
    html.includes(DISTINCT.length + " distinct codes are on"),
    "fineprint count is wrong"
  );
  assert.ok(!/Show all 8[26] codes/.test(html), "an old code count is still on the page");
  assert.ok(!/\b86 codes are on this page\b/.test(html), "the old 86 count is still in the fineprint");
});

test("A5-09: the CARC/RARC split quoted in the fineprint matches the data", () => {
  const carc = DISTINCT.filter((e) => e.type === "CARC").length;
  const rarc = DISTINCT.filter((e) => e.type === "RARC").length;
  assert.equal(carc, 52);
  assert.equal(rarc, 33);
  assert.ok(html.includes("(" + carc + " CARC and " + rarc + " RARC)"));
});

test("A5-09: alias cards are tagged GROUP + CARC rather than plain CARC", () => {
  assert.match(
    html,
    /el\("span", "tag", e\.base \? "GROUP \+ " \+ e\.type : e\.type\)/,
    "the card renderer no longer distinguishes alias entries"
  );
});

/* ---- guard against future drift on the one thing that must stay verbatim ---- */

test("no authored plain/fix text contradicts an X12 'Use only with Group Codes PR or CO' note", () => {
  for (const e of CODES) {
    if (!/Use only with Group Codes PR or CO/.test(e.meaning || "")) continue;
    const authored = (e.plain + " " + e.fix).toLowerCase();
    if (/write-off|write off|adjustment/.test(authored)) {
      assert.match(
        authored,
        /\bpr\b/,
        `${e.code} tells the clinic to adjust without mentioning the PR group code`
      );
    }
  }
});

/* The "what to do first" list is authored prose, not code data — so the guard above
   could not see it. An audit before the 2026-08-10 call found it telling clinics that
   CARC 1, 2, 3 and 45 were "money that was never yours". Deductible, coinsurance and
   copay are patient-responsibility balances the clinic IS still owed, and the same
   page's own per-code guidance says "Bill the patient for this balance." Same harmful
   direction as the CARC 45 group-code defect fixed on 2026-08-03, in a different
   sentence on the same page. */

test("the adjustments bullet does not call patient-responsibility balances 'not yours'", () => {
  const text = html.replace(/\s+/g, " ");
  assert.ok(
    !/money that was never yours/i.test(text),
    "the unqualified 'never yours' claim is back — it is false for CARC 1, 2 and 3, " +
    "which are patient-responsibility balances the clinic is still owed"
  );
});

test("the adjustments bullet distinguishes CO-45 from PR-45 and keeps 1/2/3 collectable", () => {
  const text = html.replace(/\s+/g, " ");
  assert.match(
    text,
    /patient money, not write-offs/i,
    "the list must say that CARC 1, 2 and 3 are not write-offs"
  );
  // This guard used to pin the sentence "patient-responsibility balances you are still
  // owed", which was unconditional and therefore wrong: for a Qualified Medicare
  // Beneficiary, federal law forbids billing the patient for Part A/B cost sharing, and
  // the Medicare remit STILL shows PR-1/PR-2/PR-3 with dollar amounts (CMS retained that
  // display so state Medicaid can process the crossover). Only Alert RARC N781/N782/N783
  // flags it. A regression guard can enshrine a defect; this one did.
  assert.ok(
    !/patient-responsibility balances you are still owed/i.test(text),
    "the unconditional 'still owed' sentence is back - it is false for QMB dual-eligibles"
  );
  assert.match(
    text,
    /genuinely not\s*(?:<\/strong>)?\s*yours when the line carries group code/i,
    "CARC 45 must be conditioned on the group code, not written off unconditionally"
  );
  assert.match(text, /PR-45/, "the PR-45 case must be named");
  assert.match(
    text,
    /balance-billing law/i,
    "the PR-45 caveat must survive — billing the patient is subject to state law"
  );
});

/* QMB (Qualified Medicare Beneficiary) protections. Federal law prohibits billing a QMB
   for Medicare Part A/B deductibles, coinsurance or copays. The trap the 8/8 audit found:
   the remittance still shows group code PR with a dollar amount for these patients, so the
   page's own "check the group code" rule cannot detect it — only Alert RARC N781/N782/N783
   can. Sources: CMS MLN7936176; CMS QMB RA/EOB memo (2018-04-03). */

test("the QMB alert remark codes are in the dataset and say do-not-bill", () => {
  for (const code of ["N781", "N782", "N783"]) {
    const e = CODES.find((c) => c.code === code);
    assert.ok(e, `${code} is missing from the dataset`);
    assert.equal(e.type, "RARC");
    assert.match(e.meaning, /Qualified Medicare Beneficiary/i);
    assert.match(e.fix, /do not bill the patient/i, `${code} must say do not bill`);
    assert.match(e.fix, /refund/i, `${code} must mention refunding what was collected`);
  }
});

test("CARC 1, 2 and 3 carry the QMB exception rather than a bare 'bill the patient'", () => {
  for (const code of ["1", "2", "3", "PR-1", "PR-2", "PR-3"]) {
    const e = CODES.find((c) => c.code === code && c.type === "CARC");
    assert.ok(e, `${code} missing`);
    assert.match(
      e.fix,
      /N781|Qualified Medicare Beneficiary/i,
      `${code} tells the biller to bill the patient with no QMB exception`
    );
  }
});

test("the page warns that the group code alone cannot identify a QMB", () => {
  const text = html.replace(/\s+/g, " ");
  assert.match(text, /N781, N782 or N783/, "the alert codes must be named in the prose");
  assert.match(text, /still reads PR/i, "the page must say the line still reads PR for a QMB");
  assert.match(text, /group code alone cannot tell you a QMB/i);
});

/* Nothing may be presented as X12's own wording unless it was read at the X12 source.
   The QMB alert codes were added on 2026-08-07 with descriptions written from a search
   summary, and shipped under the "Official X12 text" label inside quotation marks — the
   sixth fabricated-quotation defect in this project. Entries whose wording has not been
   verified at source must carry source:"cms" and are rendered without quote marks under
   an honest label. */

test("entries not read at the X12 source are not presented as X12 wording", () => {
  const cms = CODES.filter((e) => e.source === "cms");
  assert.ok(cms.length >= 3, "the QMB alert codes should be marked as CMS-derived");
  for (const e of cms) {
    assert.doesNotMatch(
      e.meaning,
      /^Alert: No (deductible|coinsurance|co-payment) may be collected/,
      `${e.code} still carries the unverified verbatim-looking string`
    );
    assert.equal(e.dates, "", `${e.code} publishes a start date that was never verified`);
  }
});

test("the renderer only quotes text it labels as X12's own", () => {
  assert.match(
    html,
    /if \(e\.source === "cms"\)/,
    "the card renderer no longer distinguishes sourced from described text"
  );
  assert.match(html, /our description, from CMS guidance/);
});
