/* Rendered-page regression tests. Uses Playwright if it is resolvable; skips (does not
   fail) if it is not, so `node --test 'tests/*.test.mjs'` still works on a bare checkout.

   A silent skip is how a whole class of defect hid, so CI must not tolerate one: set
   REQUIRE_PLAYWRIGHT=1 and the first test below turns a missing dependency into a
   failure instead. The CI workflow sets it and additionally rejects any tap "# skipped"
   count above zero.

   A5-01 / A5-06: no page may scroll horizontally at 320, 360 or 768 CSS pixels.
   A5-07: result panes that change without a reload must be announced, and the document
          must not skip a heading level.
   A5-08: interactive-control boundaries must reach 3:1 (WCAG 2.1 SC 1.4.11).
          https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGES = [
  "index.html",
  "request.html",
  "tools/em-calculator.html",
  "tools/npi-validator.html",
  "tools/denial-codes.html",
  "tools/timely-filing.html",
  "tools/em-mix.html"
];
const WIDTHS = [320, 360, 768];

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch {
  /* playwright not installed — the DOM tests below skip */
}

const opts = chromium ? {} : { skip: "playwright is not installed" };

/* Deliberately NOT gated by `opts` — this is the test that must fail when the others skip. */
test("the rendered-page suite is not silently skipping (REQUIRE_PLAYWRIGHT)", () => {
  if (process.env.REQUIRE_PLAYWRIGHT !== "1") return;
  assert.ok(
    chromium,
    "REQUIRE_PLAYWRIGHT=1 but playwright is not resolvable, so every rendered-page test " +
      "below would have skipped and the run would still have exited 0. Run " +
      "`npm ci && npx playwright install --with-deps chromium`."
  );
});

test("A5-01/A5-06: no page scrolls horizontally at 320, 360 or 768px", opts, async () => {
  const browser = await chromium.launch();
  try {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      for (const p of PAGES) {
        await page.goto(pathToFileURL(path.join(ROOT, p)).href);
        const m = await page.evaluate(() => ({
          s: document.documentElement.scrollWidth,
          c: document.documentElement.clientWidth
        }));
        assert.equal(m.s, m.c, `${p} at ${width}px: scrollWidth ${m.s} != clientWidth ${m.c}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});

test("A5-01: the E/M calculator's MDM fieldset stays inside its form", opts, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(ROOT, "tools/em-calculator.html")).href);
    const m = await page.evaluate(() => {
      const fs = document.querySelector("form.calc fieldset");
      const form = document.querySelector("form.calc");
      return {
        fieldset: fs.getBoundingClientRect().width,
        form: form.getBoundingClientRect().width,
        select: document.getElementById("problems").getBoundingClientRect().width,
        minInline: getComputedStyle(fs).minInlineSize
      };
    });
    assert.ok(m.fieldset <= m.form + 1, `fieldset ${m.fieldset} wider than form ${m.form}`);
    assert.ok(m.select <= m.fieldset + 1, `select ${m.select} wider than fieldset ${m.fieldset}`);
    assert.notEqual(m.minInline, "min-content", "fieldset min-inline-size is still min-content");
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test("A5-07: every live result pane is announced and no page skips a heading level", opts, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      await page.goto(pathToFileURL(path.join(ROOT, p)).href);
      const r = await page.evaluate(() => {
        const res = document.querySelector(".result");
        const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
          .map((h) => Number(h.tagName[1]));
        const skips = [];
        for (let i = 1; i < levels.length; i++) {
          if (levels[i] - levels[i - 1] > 1) skips.push(`H${levels[i - 1]} -> H${levels[i]}`);
        }
        return {
          hasResult: !!res,
          role: res && res.getAttribute("role"),
          live: res && res.getAttribute("aria-live"),
          h1s: levels.filter((l) => l === 1).length,
          skips
        };
      });
      if (r.hasResult) {
        assert.equal(r.role, "status", `${p}: .result has no role="status"`);
        assert.equal(r.live, "polite", `${p}: .result has no aria-live="polite"`);
      }
      assert.equal(r.h1s, 1, `${p}: expected exactly one h1`);
      assert.deepEqual(r.skips, [], `${p}: heading skips ${r.skips.join(", ")}`);
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
});

/* Relative luminance / contrast per WCAG 2.1. */
function luminance(rgb) {
  const c = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function parseRgb(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  assert.ok(m, "unparseable colour: " + s);
  return m[1].split(",").slice(0, 3).map((v) => Number(v.trim()));
}

test("A5-08: control boundaries reach 3:1 against both adjacent surfaces", opts, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      await page.goto(pathToFileURL(path.join(ROOT, p)).href);
      const controls = await page.evaluate(() => {
        function surfaceOf(el) {
          let n = el.parentElement;
          while (n) {
            const bg = getComputedStyle(n).backgroundColor;
            if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
            n = n.parentElement;
          }
          return getComputedStyle(document.body).backgroundColor;
        }
        return [...document.querySelectorAll(
          'select, input[type="number"], input[type="text"], input[type="date"], input[type="search"], textarea'
        )].map((el) => {
          const cs = getComputedStyle(el);
          return {
            tag: el.tagName.toLowerCase() + "#" + (el.id || "?"),
            border: cs.borderTopColor,
            width: cs.borderTopWidth,
            inside: cs.backgroundColor,
            outside: surfaceOf(el)
          };
        });
      });
      for (const c of controls) {
        if (parseFloat(c.width) === 0) continue;
        for (const surface of [c.inside, c.outside]) {
          const ratio = contrast(parseRgb(c.border), parseRgb(surface));
          assert.ok(
            ratio >= 3,
            `${p} ${c.tag}: border ${c.border} vs ${surface} is ${ratio.toFixed(2)}:1 (need 3:1)`
          );
        }
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test("A5-05: the patient-information warning outranks the fineprint on both entry points", opts, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    for (const p of ["index.html", "request.html"]) {
      await page.goto(pathToFileURL(path.join(ROOT, p)).href);
      const r = await page.evaluate(() => {
        const warn = [...document.querySelectorAll(".warn")].find((w) =>
          /don't include (any )?patient information/i.test(w.textContent)
        );
        if (!warn) return null;
        const btn = document.querySelector(".cta-box .btn");
        const cs = getComputedStyle(warn.querySelector("p"));
        return {
          warnTop: warn.getBoundingClientRect().top,
          btnTop: btn.getBoundingClientRect().top,
          fontSize: parseFloat(cs.fontSize)
        };
      });
      assert.ok(r, `${p}: no .warn panel carries the patient-information warning`);
      assert.ok(r.warnTop < r.btnTop, `${p}: the warning still sits below the action button`);
      assert.ok(r.fontSize >= 16, `${p}: the warning renders at ${r.fontSize}px, still fineprint`);
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
});

test("A5-02: the rendered result never claims a contract overrides a non-negotiable limit", opts, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(ROOT, "tools/timely-filing.html")).href);
    const ids = await page.$$eval("#payer option", (os) =>
      os.map((o) => o.value).filter(Boolean)
    );
    // Every entry that carries a published limit a contract may NOT lengthen.
    const guarded = await page.evaluate(() =>
      PAYERS.filter((p) => p.kind !== "commercial").map((p) => p.id)
    );
    const kinds = await page.evaluate(() =>
      Object.fromEntries(CHOICES.map((p) => [p.id, p.kind]))
    );
    assert.ok(guarded.includes("uhc_ma_noncontracted"), "the UHC MA floor must be guarded");
    await page.fill("#dos", "2026-01-15");
    await page.fill("#contract", "400");
    for (const id of ids) {
      await page.selectOption("#payer", id);
      const txt = await page.textContent("#result");
      if (!guarded.includes(id)) continue;
      assert.ok(
        !/overrides the published figure/.test(txt),
        `${id}: result still says a contract overrides the published figure`
      );
      assert.ok(
        /cannot lengthen it/.test(txt),
        `${id}: result does not say the typed number cannot lengthen the limit`
      );
      if (kinds[id] === "government") {
        assert.ok(
          /fixed by regulation or statute/.test(txt),
          `${id}: result does not explain that the limit is regulatory`
        );
      } else {
        assert.ok(
          /required to allow/.test(txt),
          `${id}: result does not explain that the limit is a published floor`
        );
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
});

/* Gap 1: the guard used to engage only once a payer was selected, so a staffer who meant
   Medicare but left the picker blank got an unguarded date from the typed number. */
test("A5-02b: a typed number with the payer left blank renders no date, only a prompt", opts, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(ROOT, "tools/timely-filing.html")).href);
    await page.fill("#dos", "2026-01-15");
    await page.fill("#contract", "400");
    assert.equal(await page.inputValue("#payer"), "", "the picker must start unselected");

    const txt = await page.textContent("#result");
    assert.match(txt, /Select a payer/, "the blank-payer prompt is not shown");
    assert.equal(
      await page.textContent("#r-date"),
      "",
      "a deadline was rendered with no payer selected"
    );
    // 2026-01-15 + 400 days. If this ever appears the unguarded path is back.
    assert.ok(!/February 19, 2027/.test(txt), "an unguarded deadline was rendered");

    // The two fallbacks are what keeps that from locking a real payer out. Each is
    // reached from a payer that DOES have a citation, so a stale "Source:" line left
    // over from the previous selection would be caught rather than passing by luck.
    for (const [id, expect] of [
      ["other_commercial", /participation agreement is the authority/],
      ["other_government", /never from a participation agreement/]
    ]) {
      await page.selectOption("#payer", "medicare_ffs");
      assert.match(
        await page.textContent("#result"),
        /Source:/,
        "precondition: a sourced payer must render a source line"
      );
      await page.selectOption("#payer", id);
      const t = await page.textContent("#result");
      assert.match(t, /February 19, 2027/, `${id}: the typed number should now be used`);
      assert.match(t, expect, `${id}: the unverified caveat is missing`);
      assert.ok(
        !/Source:/.test(t),
        `${id}: a source line was rendered for a payer we hold no source for`
      );
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
});

/* Every tool form must refuse a native submit.
 *
 * Found 2026-08-14: em-calculator.html was the only one of the six forms across both sites
 * without `onsubmit="return false"`. Pressing Enter in the minutes field submitted it,
 * producing a same-origin GET and a full reload that wiped everything entered. Not a privacy
 * problem — no field on that page carries a `name`, so the query string was a bare `?` and
 * nothing typed reached a server log — but it cost a user their work on the tool a physician
 * is most likely to try first.
 *
 * These are calculators. None of them has anywhere to submit to; a native submit is always a
 * bug. Asserted here so a new tool cannot ship without the guard.
 */
test("every form refuses a native submit and posts nowhere", () => {
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, p), "utf8");
    for (const m of html.matchAll(/<form\b[^>]*>/gi)) {
      const tag = m[0];
      assert.match(
        tag,
        /onsubmit\s*=\s*"return false;?"/i,
        `${p}: form without a submit guard — pressing Enter reloads and wipes input: ${tag}`
      );
      assert.doesNotMatch(tag, /\baction\s*=/i, `${p}: form has an action attribute: ${tag}`);
    }
  }
});
