/* Tests for tools/npi-validator.html.
 *
 * This page shipped with no test file at all. An audit before the 2026-08-10 call found
 * that its PROSE claimed "A transposed digit produces an NPI that fails the checksum" —
 * an unqualified universal that the page's own validator contradicts on screen. The
 * algorithm was and is correct; the sentence was not.
 *
 * These tests pin both halves: the checksum stays right, and the page keeps telling the
 * truth about what the checksum cannot see.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const PAGE = path.resolve(import.meta.dirname, "..", "tools", "npi-validator.html");
const html = fs.readFileSync(PAGE, "utf8");

function loadValidNpi() {
  const start = html.indexOf("/* ==BEGIN CORE== */");
  const end = html.indexOf("/* ==END CORE== */");
  assert.notEqual(start, -1, "CORE markers not found in tools/npi-validator.html");
  assert.notEqual(end, -1, "CORE end marker not found in tools/npi-validator.html");
  const ctx = vm.createContext({});
  vm.runInContext(html.slice(start, end) + "\n;this.__core = validNpi;", ctx);
  return ctx.__core;
}

const validNpi = loadValidNpi();
const ok = (n) => validNpi(n).ok;

/* An independent second implementation. If both agree across a large sweep, a
   single-implementation slip (the off-by-one class of bug that hit the sibling
   engine's NPI check in medcode PR #249) cannot hide. */
function referenceOk(npi) {
  const n = String(npi).replace(/\D/g, "");
  if (n.length !== 10) return false;
  const payload = "80840" + n.slice(0, 9);
  let total = 0;
  const rev = [...payload].reverse();
  for (let i = 0; i < rev.length; i++) {
    let d = Number(rev[i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    total += d;
  }
  return (10 - (total % 10)) % 10 === Number(n[9]);
}

test("known-good NPIs validate", () => {
  // 1234567893 is the worked example in the CMS NPI check-digit specification.
  assert.equal(ok("1234567893"), true, "CMS worked example must validate");
  assert.equal(ok("1245319599"), true);
  assert.equal(ok("1679576722"), true);
});

test("a corrupted check digit is rejected, and the advice names the right digit", () => {
  for (const good of ["1234567893", "1245319599", "1679576722"]) {
    const right = Number(good[9]);
    for (let d = 0; d <= 9; d++) {
      if (d === right) continue;
      const bad = good.slice(0, 9) + d;
      const r = validNpi(bad);
      assert.equal(r.ok, false, `${bad} must be rejected`);
      assert.equal(r.expected, right, `advice for ${bad} must name digit ${right}`);
    }
  }
});

test("non-10-digit and junk input is reported as a length problem, never as valid", () => {
  for (const bad of ["", "1", "123456789", "12345678901", "abcdefghij", "   ", "12345678930"]) {
    const r = validNpi(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must not validate`);
  }
  assert.equal(validNpi("123456789").why, "length");
  // Every non-digit is stripped, so a formatted valid NPI still validates. This is
  // deliberate — a user pasting from a directory should not be told their NPI is bad.
  assert.equal(ok("1234-567-893"), true);
  assert.equal(ok("1234 567 893"), true);
  assert.equal(ok("+1234567893"), true);
  assert.equal(ok("NPI: 1234567893"), true);
});

test("the page's validator agrees with an independent implementation", () => {
  let checked = 0;
  for (let i = 0; i < 30000; i++) {
    const n = String(1000000000 + ((i * 2654435761) % 8999999999));
    assert.equal(ok(n), referenceOk(n), `disagreement on ${n}`);
    checked++;
  }
  assert.ok(checked >= 30000);
});

/* ---- the property the page now states in prose ---- */

function makeValid(seed) {
  const body = String(100000000 + (seed % 900000000));
  for (let c = 0; c <= 9; c++) if (ok(body + c)) return body + c;
  throw new Error("no check digit found for " + body);
}

test("Luhn misses only 0<->9 when the swapped digits are an ODD number of places apart", () => {
  for (const gap of [1, 3]) {
    const missedPairs = new Set();
    let missed = 0, total = 0;
    for (let s = 0; s < 2000; s++) {
      const v = makeValid(s * 7919);
      for (let i = 0; i + gap < 10; i++) {
        const j = i + gap;
        if (v[i] === v[j]) continue;
        const t = [...v];
        [t[i], t[j]] = [t[j], t[i]];
        total++;
        if (ok(t.join(""))) {
          missed++;
          missedPairs.add([v[i], v[j]].sort().join(""));
        }
      }
    }
    assert.ok(total > 10000, `gap ${gap}: expected a real sweep, got ${total}`);
    assert.deepEqual([...missedPairs], ["09"],
      `gap ${gap}: Luhn should miss 0<->9 and nothing else, saw ${[...missedPairs]}`);
    assert.ok(missed > 0, `gap ${gap}: the 0<->9 blind spot must be demonstrable`);
  }
});

test("Luhn misses EVERY swap of digits an even number of places apart", () => {
  for (const gap of [2, 4]) {
    let missed = 0, total = 0;
    for (let s = 0; s < 1500; s++) {
      const v = makeValid(s * 7919);
      for (let i = 0; i + gap < 10; i++) {
        const j = i + gap;
        if (v[i] === v[j]) continue;
        const t = [...v];
        [t[i], t[j]] = [t[j], t[i]];
        total++;
        if (ok(t.join(""))) missed++;
      }
    }
    assert.ok(total > 5000, `gap ${gap}: expected a real sweep, got ${total}`);
    assert.equal(missed, total,
      `gap ${gap}: both digits sit in the same doubling parity class, so the checksum is ` +
      `unchanged — all ${total} should slip through, ${missed} did`);
  }
});

/* ---- the prose guard: this is the defect that was actually shipped ---- */

test("the page does not claim that a transposed digit always fails the checksum", () => {
  const text = html.replace(/\s+/g, " ");
  assert.ok(
    !/A transposed digit produces an NPI that fails the checksum/i.test(text),
    "the unqualified universal is back — it is false for an adjacent 0/9 swap and for " +
    "every even-distance swap, and the page's own validator shows a green check on both"
  );
});

test("the page states both limits of the checksum", () => {
  const text = html.replace(/\s+/g, " ");
  assert.match(text, /Luhn/, "the page should name the algorithm it relies on");
  assert.match(text, /adjacent[^.]*unless those digits are a 0 and a 9/i,
    "the adjacent-0/9 blind spot must be stated");
  assert.match(text, /an even number of places apart/i,
    "the even-distance blind spot must be stated");
  assert.match(text, /NPPES/, "the page must still send the user to the registry");
});
