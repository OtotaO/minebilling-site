/* Rendered-page regression tests. Uses Playwright if it is resolvable; skips (does not
   fail) if it is not, so `node --test 'tests/*.test.mjs'` still works on a bare checkout.

   A5-01 / A5-06: no page may scroll horizontally at 320, 360 or 768 CSS pixels.
   A5-07: result panes that change without a reload must be announced, and the document
          must not skip a heading level.
   A5-08: interactive-control boundaries must reach 3:1 (WCAG 2.1 SC 1.4.11).
          https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
*/
import test from "node:test";
import assert from "node:assert/strict";
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

test("A5-02: the rendered result never claims a contract overrides a government limit", opts, async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(path.join(ROOT, "tools/timely-filing.html")).href);
    const ids = await page.$$eval("#payer option", (os) =>
      os.map((o) => o.value).filter(Boolean)
    );
    const government = await page.evaluate(() =>
      PAYERS.filter((p) => p.kind !== "commercial").map((p) => p.id)
    );
    await page.fill("#dos", "2026-01-15");
    await page.fill("#contract", "400");
    for (const id of ids) {
      await page.selectOption("#payer", id);
      const txt = await page.textContent("#result");
      if (government.includes(id)) {
        assert.ok(
          !/overrides the published figure/.test(txt),
          `${id}: result still says a contract overrides the published figure`
        );
        assert.ok(
          /set by regulation or statute/.test(txt),
          `${id}: result does not explain that the limit is regulatory`
        );
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }
});
