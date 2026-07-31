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
  assert.equal(CODES.length, 86);
  assert.equal(ALIASES.length, 4);
  assert.equal(DISTINCT.length, 82);
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
  assert.ok(!/Show all 86 codes/.test(html), "the old 86 count is still on the page");
  assert.ok(!/\b86 codes are on this page\b/.test(html), "the old 86 count is still in the fineprint");
});

test("A5-09: the CARC/RARC split quoted in the fineprint matches the data", () => {
  const carc = DISTINCT.filter((e) => e.type === "CARC").length;
  const rarc = DISTINCT.filter((e) => e.type === "RARC").length;
  assert.equal(carc, 52);
  assert.equal(rarc, 30);
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
