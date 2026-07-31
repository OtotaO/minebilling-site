/* Regression tests for the timely-filing calculator's pure logic (tools/timely-filing.html,
   ==CORE== block). Run with: node --test tests/

   The load-bearing one is A5-02: the "my contract says ___ days" field must never be able
   to LENGTHEN a statutory or regulatory filing limit.

   Primary sources verified 2026-07-31:
   - 42 CFR 424.44(a): "Except as provided in paragraphs (b) and (e) of this section, for
     services furnished on or after January 1, 2010, the claim must be filed no later than
     the close of the period ending 1 calendar year after the date of service."
     https://www.govinfo.gov/content/pkg/CFR-2023-title42-vol3/xml/CFR-2023-title42-vol3-sec424-44.xml
     The section contains no provision letting a provider agreement extend the period.
   - 42 CFR 447.45(d)(1): "The Medicaid agency must require providers to submit all claims
     no later than 12 months from the date of service."
     https://www.govinfo.gov/content/pkg/CFR-2023-title42-vol4/xml/CFR-2023-title42-vol4-sec447-45.xml
   - CMS Pub 100-04 Ch.1 §70.4: an untimely-filing denial "does not constitute an initial
     determination", so it is not appealable.
     https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/clm104c01.pdf
*/
import test from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./load-core.mjs";

const { evaluate, PAYERS, findPayer } = loadCore();
const TODAY = "2026-07-31";

const GOVERNMENT = PAYERS.filter((p) => p.kind !== "commercial").map((p) => p.id);
const COMMERCIAL = PAYERS.filter((p) => p.kind === "commercial").map((p) => p.id);

test("the payer table still contains both government and commercial entries", () => {
  assert.ok(GOVERNMENT.length >= 5, "expected the government payers to still be present");
  assert.ok(COMMERCIAL.length >= 1, "expected commercial payers to still be present");
});

/* ---- A5-02: a typed contract number may not lengthen a statutory limit ---- */

test("A5-02: Medicare keeps its 1-calendar-year limit when a longer contract number is typed", () => {
  const r = evaluate("medicare_ffs", "2026-01-15", "400", TODAY);
  assert.equal(r.ok, true);
  // 42 CFR 424.44(a): 1 calendar year after the date of service.
  assert.equal(r.deadline, "2027-01-15");
  assert.equal(r.basis, "published");
  assert.equal(r.statutory, true);
  assert.equal(r.contract_capped, true);
  assert.equal(r.rule_word, "1 calendar year");
});

test("A5-02: Illinois Medicaid keeps its 180-day limit when a longer contract number is typed", () => {
  const r = evaluate("il_medicaid_ffs", "2026-01-15", "365", TODAY);
  assert.equal(r.deadline, "2026-07-14"); // 2026-01-15 + 180 calendar days
  assert.equal(r.basis, "published");
  assert.equal(r.contract_capped, true);
});

test("A5-02: no government payer's deadline can be pushed out by any contract number", () => {
  for (const id of GOVERNMENT) {
    const published = evaluate(id, "2026-01-15", "", TODAY);
    for (const days of ["1", "90", "200", "365", "400", "1095"]) {
      const withContract = evaluate(id, "2026-01-15", days, TODAY);
      assert.ok(
        withContract.deadline <= published.deadline,
        `${id} + ${days} days gave ${withContract.deadline}, later than the published ${published.deadline}`
      );
      assert.equal(withContract.statutory, true);
    }
  }
});

test("A5-02: a SHORTER internal number is honoured on a government payer, and is labelled as not overriding", () => {
  const r = evaluate("medicare_ffs", "2026-01-15", "90", TODAY);
  assert.equal(r.deadline, "2026-04-15"); // 2026-01-15 + 90 days
  assert.equal(r.basis, "contract");
  assert.equal(r.statutory, true);
  assert.equal(r.contract_capped, false);
  assert.equal(r.published_word, "1 calendar year");
});

test("A5-02: commercial payers are unchanged — the contract number still governs both ways", () => {
  for (const id of COMMERCIAL) {
    const long = evaluate(id, "2026-01-15", "1000", TODAY);
    assert.equal(long.basis, "contract", `${id} should let the agreement lengthen the default`);
    assert.equal(long.statutory, false);
    assert.equal(long.deadline, "2028-10-11"); // 2026-01-15 + 1000 days
    const short = evaluate(id, "2026-01-15", "30", TODAY);
    assert.equal(short.basis, "contract");
    assert.equal(short.deadline, "2026-02-14");
  }
});

test("A5-02: with no payer selected the typed number is still used as-is", () => {
  const r = evaluate("", "2026-01-15", "120", TODAY);
  assert.equal(r.basis, "contract");
  assert.equal(r.statutory, false);
  assert.equal(r.deadline, "2026-05-15");
});

test("A5-02: the second clock survives a statutory contract entry (Texas 365-day federal deadline)", () => {
  const capped = evaluate("tx_medicaid_ffs", "2026-01-15", "400", TODAY);
  assert.equal(capped.deadline, "2026-04-20"); // 95 days
  assert.ok(capped.second_clock, "federal 365-day clock must still be shown");
  assert.equal(capped.second_clock.deadline, "2027-01-15");

  const shorter = evaluate("tx_medicaid_ffs", "2026-01-15", "30", TODAY);
  assert.equal(shorter.basis, "contract");
  assert.ok(shorter.second_clock, "federal 365-day clock must still be shown");
});

/* ---- unchanged behaviour that the A5-02 refactor must not break ---- */

test("published limits are unchanged when no contract number is typed", () => {
  assert.equal(evaluate("medicare_ffs", "2026-01-15", "", TODAY).deadline, "2027-01-15");
  assert.equal(evaluate("medicaid_federal", "2026-01-15", "", TODAY).deadline, "2027-01-15");
  assert.equal(evaluate("il_medicaid_ffs", "2026-01-15", "", TODAY).deadline, "2026-07-14");
  assert.equal(evaluate("tx_medicaid_ffs", "2026-01-15", "", TODAY).deadline, "2026-04-20");
  assert.equal(evaluate("ny_medicaid", "2026-01-15", "", TODAY).deadline, "2026-04-15");
});

test("February 29 is handled per CMS Pub 100-04 Ch.1 §70.1 (file by February 28)", () => {
  assert.equal(evaluate("medicare_ffs", "2024-02-29", "", TODAY).deadline, "2025-02-28");
});

test("contract-day input is still validated", () => {
  assert.equal(evaluate("medicare_ffs", "2026-01-15", "0", TODAY).ok, false);
  assert.equal(evaluate("medicare_ffs", "2026-01-15", "1096", TODAY).ok, false);
  assert.equal(evaluate("medicare_ffs", "2026-01-15", "12.5", TODAY).ok, false);
  assert.equal(evaluate("medicare_ffs", "", "", TODAY).error, "need_date");
  assert.equal(evaluate("", "2026-01-15", "", TODAY).error, "need_payer_or_contract");
});

test("every payer entry still carries a source URL and an as-of date", () => {
  for (const p of PAYERS) {
    assert.ok(p.source_url && /^https:\/\//.test(p.source_url), `${p.id} missing source_url`);
    assert.ok(p.as_of, `${p.id} missing as_of`);
    assert.ok(p.limit_text, `${p.id} missing limit_text`);
    assert.ok(["government", "commercial"].includes(p.kind), `${p.id} has an unknown kind`);
  }
  assert.equal(findPayer("nope"), null);
});
