/* Ad-hoc viewport measurement helper (not part of the test suite).
   Usage: node tests/measure.mjs [width ...]
   Prints scrollWidth vs clientWidth for every page at every width. */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

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
const widths = process.argv.slice(2).map(Number).filter(Boolean);
const WIDTHS = widths.length ? widths : [320, 360, 768];

const browser = await chromium.launch();
for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    await page.goto(pathToFileURL(path.join(ROOT, p)).href);
    const m = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth,
      c: document.documentElement.clientWidth
    }));
    console.log(`${w}\t${p}\tscrollWidth=${m.s}\tclientWidth=${m.c}\t${m.s > m.c ? "OVERFLOW" : "ok"}`);
  }
  await ctx.close();
}
await browser.close();
