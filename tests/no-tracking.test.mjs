/* Runtime proof that nothing on this site talks to a third party.
 *
 * WHY A RUNTIME TEST AND NOT JUST THE STATIC ONE.
 * `seo.test.mjs` already asserts that no page carries an external <script src>, <link href>,
 * <img src> or <iframe>. That is a regex over the served HTML, and it is worth keeping — but
 * it cannot see the way tracking pixels are actually installed. The MyChart-portal
 * settlements of 2022-2026 did not turn on a visible <script src="facebook.com/...">; they
 * turned on snippets and tag managers that construct a request at runtime. None of these
 * would trip the static check:
 *
 *     new Image().src = "https://www.facebook.com/tr?id=...&ev=PageView";
 *     navigator.sendBeacon("https://analytics.example/collect", payload);
 *     fetch("https://region1.google-analytics.com/g/collect?...");
 *     @import url("https://fonts.googleapis.com/css2?family=Inter");
 *     <form action="https://third-party.example/submit">
 *
 * So this test loads every page in a real browser and records EVERY request the page makes,
 * from any source, and fails if a single one leaves our own origin. It also asserts no
 * cookies and no web storage, because a first-party identifier is still an identifier.
 *
 * This is the claim the compliance position rests on, so it is asserted mechanically rather
 * than promised in prose. A stranger can reproduce it: open devtools, Network tab, reload.
 *
 * It is deliberately strict. If a future change genuinely needs an external resource, the
 * right move is to self-host it, not to loosen this test.
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

/* Names that must never appear in served markup or script. Not a substitute for the runtime
   check below — a belt-and-braces catch for a snippet pasted in but not yet firing. */
const TRACKER_TOKENS = [
  "googletagmanager", "google-analytics", "gtag(", "connect.facebook.net", "fbq(",
  "facebook.com/tr", "hotjar", "segment.com", "analytics.js", "mixpanel",
  "snap.licdn.com", "analytics.tiktok", "clarity.ms", "plausible.io", "usefathom",
  "matomo", "doubleclick", "sentry-cdn", "browser.sentry", "fullstory", "logrocket"
];

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch {
  /* handled below */
}
const required = process.env.REQUIRE_PLAYWRIGHT === "1";
const opts = chromium ? {} : { skip: "playwright not installed" };

test("playwright is available when CI demands it", () => {
  if (required) assert.ok(chromium, "REQUIRE_PLAYWRIGHT=1 but playwright is not resolvable");
});

test("no page contacts any host but its own, and none sets a cookie or storage", opts, async () => {
  const browser = await chromium.launch();
  try {
    for (const p of PAGES) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const offOrigin = [];

      // Every request the page makes, whatever created it: markup, inline script,
      // fetch/XHR, sendBeacon, CSS url(), prefetch, favicon, anything.
      page.on("request", (r) => {
        const url = r.url();
        if (url.startsWith("file://") || url.startsWith("data:") || url.startsWith("blob:")) return;
        offOrigin.push(`${r.resourceType()} ${url}`);
      });

      await page.goto(pathToFileURL(path.join(ROOT, p)).href, { waitUntil: "networkidle" });
      // Give any deferred beacon a chance to fire before we judge the page.
      await page.waitForTimeout(250);

      assert.deepEqual(
        offOrigin,
        [],
        `${p} made ${offOrigin.length} request(s) off its own origin:\n    ` +
          offOrigin.join("\n    ")
      );

      const state = await page.evaluate(() => ({
        cookies: document.cookie,
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage)
      }));
      assert.equal(state.cookies, "", `${p} set a cookie: ${state.cookies}`);
      assert.deepEqual(state.local, [], `${p} wrote to localStorage`);
      assert.deepEqual(state.session, [], `${p} wrote to sessionStorage`);

      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});

test("using a tool does not cause a single outbound request", opts, async () => {
  // The strongest version of "it computes in your browser": drive the tools with real input
  // and prove nothing leaves. A calculator that quietly posts what you typed is the exact
  // shape of the defect these tests exist to prevent.
  const drives = [
    ["tools/npi-validator.html", async (page) => { await page.fill("#npi", "1234567893"); }],
    ["tools/em-calculator.html", async (page) => {
      await page.selectOption("#ptype", "est");
      await page.fill("#minutes", "25");
      await page.selectOption("#problems", "2");
    }],
    ["tools/denial-codes.html", async (page) => {
      const box = page.locator('input[type="search"], input[type="text"]').first();
      if (await box.count()) await box.fill("45");
    }],
    ["tools/timely-filing.html", async (page) => {
      const d = page.locator('input[type="date"]').first();
      if (await d.count()) await d.fill("2026-01-15");
    }]
  ];

  const browser = await chromium.launch();
  try {
    for (const [p, drive] of drives) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(path.join(ROOT, p)).href, { waitUntil: "networkidle" });

      // Only count what happens AFTER the page has settled, so this isolates the tool.
      const after = [];
      page.on("request", (r) => {
        const url = r.url();
        if (url.startsWith("data:") || url.startsWith("blob:")) return;
        after.push(`${r.resourceType()} ${url}`);
      });

      await drive(page);
      await page.waitForTimeout(400);

      assert.deepEqual(
        after,
        [],
        `${p} made ${after.length} request(s) while being used:\n    ` + after.join("\n    ")
      );
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});

test("no tracker snippet is present in any served page, firing or not", () => {
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, p), "utf8").toLowerCase();
    const hits = TRACKER_TOKENS.filter((t) => html.includes(t.toLowerCase()));
    assert.deepEqual(hits, [], `${p} contains tracker token(s): ${hits.join(", ")}`);
  }
});

test("no form on the site posts to another origin", () => {
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, p), "utf8");
    for (const m of html.matchAll(/<form\b[^>]*\baction="([^"]+)"/gi)) {
      assert.doesNotMatch(
        m[1],
        /^https?:\/\//i,
        `${p} has a form posting off-origin to ${m[1]}`
      );
    }
  }
});
