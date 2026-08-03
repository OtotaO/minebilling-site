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

   Re-verified 2026-08-03, for the three gaps closed in this pass:
   - 42 CFR 424.44 paragraph (e), current eCFR text (title 42 as issued 2026-07-30) is
     byte-identical to the 2023 annual edition above:
     "As specified in 424.520 and 424.521 of this subpart, there are restrictions on the
     ability of the following newly-enrolled suppliers to submit claims for items or
     services furnished prior to the effective date of their Medicare billing privileges".
   - 2026 UnitedHealthcare Care Provider Administrative Guide, "Time limits for filing
     claims" (p.206), fetched from uhcprovider.com and read from the PDF's own text layer:
     "For MA plans, we are required to allow 365 days from the through date of service for
     noncontracted health care providers to submit claims for processing."
     The Agreement carve-out in the same paragraph is scoped to commercial claims only
     ("For commercial claims, submit clean claims per the time frame listed in your
     Agreement or per applicable laws"), so it does not reach that sentence. A floor the
     payer is required to allow is not a term an agreement lengthens -> kind is
     "mandated_floor", not "commercial".
*/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadCore } from "./load-core.mjs";

const { evaluate, PAYERS, UNLISTED, CHOICES, findPayer, contractMayLengthen } = loadCore();
const TODAY = "2026-07-31";

/* "not extendable by a participation agreement" is the property the guard is about, and it
   is exactly `kind !== "commercial"` — statutory limits and payer-published floors alike. */
const GOVERNMENT = PAYERS.filter((p) => p.kind !== "commercial").map((p) => p.id);
const COMMERCIAL = PAYERS.filter((p) => p.kind === "commercial").map((p) => p.id);

test("the payer table still contains both government and commercial entries", () => {
  assert.ok(GOVERNMENT.length >= 5, "expected the government payers to still be present");
  assert.ok(COMMERCIAL.length >= 1, "expected commercial payers to still be present");
});

test("kind drives extendability, and nothing else does", () => {
  for (const p of CHOICES) {
    assert.equal(contractMayLengthen(p), p.kind === "commercial", `${p.id}`);
  }
  assert.equal(contractMayLengthen(null), false);
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

/* ---- gap 1: the guard used to engage only once a payer was selected ---- */

test("A5-02b: a typed number with NO payer selected produces no date at all", () => {
  const r = evaluate("", "2026-01-15", "120", TODAY);
  assert.equal(r.ok, false, "an unguarded deadline must not be computed without a payer");
  assert.equal(r.error, "need_payer");
  assert.equal(r.deadline, undefined);
  assert.match(r.message, /Select a payer/);
});

test("A5-02b: a payer is required even with nothing typed in the contract field", () => {
  assert.equal(evaluate("", "2026-01-15", "", TODAY).error, "need_payer");
});

test("A5-02b: no input combination reaches a date without a payer", () => {
  for (const days of ["", "1", "90", "365", "400", "1095"]) {
    const r = evaluate("", "2026-01-15", days, TODAY);
    assert.equal(r.ok, false, `blank payer + ${days || "(blank)"} days still produced a result`);
  }
});

/* The two "not listed" fallbacks are what keeps that from locking anyone out. They carry
   no published limit, so they can never produce a verified date. */

test("A5-02b: the not-listed fallbacks exist, one per authority kind, with no published limit", () => {
  // Array.from: UNLISTED comes back from a vm realm, so a bare .map() array is not
  // deepStrictEqual to a literal one here.
  assert.deepEqual(
    Array.from(UNLISTED, (p) => p.id).sort(),
    ["other_commercial", "other_government"]
  );
  for (const p of UNLISTED) {
    assert.equal(p.rule, undefined, `${p.id} must carry no published rule`);
    assert.equal(p.unlisted, true);
    assert.ok(p.contract_note, `${p.id} needs a contract_note — it is the only caveat shown`);
  }
  assert.equal(CHOICES.length, PAYERS.length + UNLISTED.length);
  for (const p of UNLISTED) {
    assert.ok(!PAYERS.includes(p), `${p.id} must stay out of the primary-sourced PAYERS list`);
  }
});

test("A5-02b: an unlisted COMMERCIAL payer uses the typed number, flagged unverified", () => {
  const r = evaluate("other_commercial", "2026-01-15", "120", TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.deadline, "2026-05-15");
  assert.equal(r.basis, "contract");
  assert.equal(r.statutory, false);
  assert.equal(r.has_published, false);
  assert.equal(r.unverified_limit, false);
});

test("A5-02b: an unlisted GOVERNMENT payer is flagged as unverifiable, never as checked", () => {
  const r = evaluate("other_government", "2026-01-15", "400", TODAY);
  assert.equal(r.ok, true);
  assert.equal(r.deadline, "2027-02-19"); // 2026-01-15 + 400 days — the user's own number
  assert.equal(r.basis, "contract");
  assert.equal(r.statutory, true, "must still be treated as a non-extendable authority");
  assert.equal(r.unverified_limit, true, "we hold no limit for it, and must say so");
  assert.equal(r.contract_capped, false);
  assert.equal(r.published_word, null);
  assert.equal(r.has_published, false);
});

test("A5-02b: an unlisted payer with no typed number refuses to guess", () => {
  for (const id of ["other_commercial", "other_government"]) {
    const r = evaluate(id, "2026-01-15", "", TODAY);
    assert.equal(r.ok, false, `${id} must not invent a limit`);
    assert.equal(r.error, "need_contract");
    assert.match(r.message, /no published limit/);
  }
});

/* ---- gap 2: a payer-published FLOOR is not extendable either ----
   2026 UnitedHealthcare Care Provider Administrative Guide, p.206: "For MA plans, we are
   required to allow 365 days from the through date of service for noncontracted health
   care providers to submit claims for processing." Classifying that as "commercial" let a
   typed number push it out, which is wrong in the same direction as extending a statute. */

test("A5-02c: UHC Medicare Advantage non-contracted is classified as a mandated floor", () => {
  const uhcMa = findPayer("uhc_ma_noncontracted");
  assert.equal(uhcMa.kind, "mandated_floor");
  assert.equal(contractMayLengthen(uhcMa), false);
  assert.match(uhcMa.limit_text, /we are required to allow 365 days from the through date of service/);
  assert.ok(uhcMa.floor_note, "the non-contracted-only scope must stay on screen");
});

test("A5-02c: no contract number can push the UHC MA 365-day floor out", () => {
  for (const days of ["366", "400", "730", "1095"]) {
    const r = evaluate("uhc_ma_noncontracted", "2026-01-15", days, TODAY);
    assert.equal(r.deadline, "2027-01-15"); // 2026-01-15 + 365 days
    assert.equal(r.basis, "published");
    assert.equal(r.statutory, true);
    assert.equal(r.contract_capped, true);
    assert.equal(r.rule_word, "365 calendar days");
  }
});

test("A5-02c: a SHORTER number is still honoured against the UHC MA floor", () => {
  const r = evaluate("uhc_ma_noncontracted", "2026-01-15", "90", TODAY);
  assert.equal(r.deadline, "2026-04-15");
  assert.equal(r.basis, "contract");
  assert.equal(r.statutory, true);
  assert.equal(r.contract_capped, false);
  assert.equal(r.published_word, "365 calendar days");
});

test("A5-02c: the other UHC floors stay extendable — they are floors the AGREEMENT may raise", () => {
  // "we give you at least 90 days from the day of payment, contest, denial or notice from
  // the primary payer" and "we allow up to 180 days for nonparticipating health care
  // providers" both sit under "per the time frame listed in your Agreement or per
  // applicable laws", so a longer contracted number is legitimate for them.
  for (const id of ["uhc_cob", "uhc_comm_nonpar"]) {
    const r = evaluate(id, "2026-01-15", "400", TODAY);
    assert.equal(r.basis, "contract", `${id}`);
    assert.equal(r.statutory, false, `${id}`);
    assert.equal(r.deadline, "2027-02-19");
  }
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
  assert.equal(evaluate("", "2026-01-15", "", TODAY).error, "need_payer");
  assert.equal(evaluate("other_commercial", "2026-01-15", "0", TODAY).ok, false);
});

test("every payer entry still carries a source URL and an as-of date", () => {
  for (const p of PAYERS) {
    assert.ok(p.source_url && /^https:\/\//.test(p.source_url), `${p.id} missing source_url`);
    assert.ok(p.as_of, `${p.id} missing as_of`);
    assert.ok(p.limit_text, `${p.id} missing limit_text`);
    assert.ok(
      ["government", "commercial", "mandated_floor"].includes(p.kind),
      `${p.id} has an unknown kind: ${p.kind}`
    );
  }
  assert.equal(findPayer("nope"), null);
});

test("42 CFR 424.44(e) is disclosed as a case where this page is more generous than the law", () => {
  // Verbatim from the current eCFR text of 42 CFR 424.44(e) (title 42 as issued
  // 2026-07-30), identical to the 2023 annual edition the page already links.
  const html = readFileSync(
    resolve(import.meta.dirname, "..", "tools/timely-filing.html"),
    "utf8"
  );
  // Tags stripped and whitespace collapsed, so the assertions are about the words a
  // clinic reads, not about how the source file happens to wrap.
  const gaps = html
    .slice(html.indexOf('id="gaps"'), html.indexOf('<div class="qa">'))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ");
  assert.match(gaps, /424\.44\(a\)\(1\) opens/);
  assert.match(
    gaps,
    /there are restrictions on the ability of the following newly-enrolled suppliers to submit claims for items or services furnished prior to the effective date of their Medicare billing privileges: \(1\) Physician or nonphysician practitioner organizations\. \(2\) Physicians\. \(3\) Nonphysician practitioners\. \(4\) Independent diagnostic testing facilities\./,
    "paragraph (e) must be quoted in full, not paraphrased"
  );
  assert.match(gaps, /424\.520\(d\)\(1\)/);
  assert.match(gaps, /424\.521\(a\)\(1\)/);
  assert.match(gaps, /\(i\) Thirty days prior to their effective date if circumstances precluded enrollment in advance of providing services to Medicare beneficiaries; or \(ii\) Ninety days prior to their effective date/);
  assert.match(gaps, /more generous than the regulation/);
});
