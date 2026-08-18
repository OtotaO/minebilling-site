/* A5-12: SEO hygiene on the pages that are the SEO surface, plus the invariants the site
   already relied on (canonical, lang, sitemap coverage, no external requests). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = "https://minebilling.com/";
const PAGES = {
  "index.html": BASE,
  "request.html": BASE + "request.html",
  "tools/em-calculator.html": BASE + "tools/em-calculator.html",
  "tools/denial-codes.html": BASE + "tools/denial-codes.html",
  "tools/timely-filing.html": BASE + "tools/timely-filing.html",
  "tools/em-mix.html": BASE + "tools/em-mix.html",
  "tools/npi-validator.html": BASE + "tools/npi-validator.html"
};
const TOOLS = Object.keys(PAGES).filter((p) => p.startsWith("tools/"));

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const meta = (html, prop) => {
  const m = html.match(new RegExp('<meta property="' + prop + '" content="([\\s\\S]*?)">'));
  return m ? decode(m[1]) : null;
};

test("A5-12: titles fit the ~60 character SERP window", () => {
  for (const p of Object.keys(PAGES)) {
    const t = decode(read(p).match(/<title>([\s\S]*?)<\/title>/)[1]);
    assert.ok(t.length <= 64, `${p}: title is ${t.length} chars — "${t}"`);
  }
});

test("A5-12: meta descriptions fit the ~160 character SERP window", () => {
  for (const p of Object.keys(PAGES)) {
    const d = decode(read(p).match(/<meta name="description" content="([\s\S]*?)">/)[1]);
    assert.ok(d.length <= 165, `${p}: description is ${d.length} chars`);
    assert.ok(d.length >= 70, `${p}: description is only ${d.length} chars`);
  }
});

test("A5-12: every page has og:title, og:description, og:type and a correct og:url", () => {
  for (const [p, url] of Object.entries(PAGES)) {
    const html = read(p);
    for (const prop of ["og:title", "og:description", "og:type"]) {
      assert.ok(meta(html, prop), `${p}: missing ${prop}`);
    }
    assert.equal(meta(html, "og:url"), url, `${p}: og:url does not match the live URL`);
  }
});

test("canonical, lang and a single h1 are still correct on every page", () => {
  for (const [p, url] of Object.entries(PAGES)) {
    const html = read(p);
    const c = html.match(/<link rel="canonical" href="([^"]+)">/);
    assert.ok(c, `${p}: no canonical`);
    assert.equal(c[1], url, `${p}: canonical does not match the live URL`);
    assert.match(html, /<html lang="en">/, `${p}: missing lang`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${p}: expected exactly one h1`);
  }
});

test("A5-12: every tool page cross-links all five tools", () => {
  for (const p of TOOLS) {
    const html = read(p);
    const bar = html.match(/<nav class="toolbar"[\s\S]*?<\/nav>/);
    assert.ok(bar, `${p}: no free-tools nav row`);
    for (const other of TOOLS) {
      const href = other.replace("tools/", "");
      assert.ok(bar[0].includes('href="' + href + '"'), `${p}: does not link ${href}`);
    }
    const self = p.replace("tools/", "");
    assert.ok(
      bar[0].includes('href="' + self + '" aria-current="page"'),
      `${p}: its own entry is not marked aria-current`
    );
  }
});

test("sitemap.xml still lists exactly the seven live pages", () => {
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  assert.deepEqual(locs, Object.values(PAGES).sort());
});

test("no page loads anything from another host", () => {
  for (const p of Object.keys(PAGES)) {
    const html = read(p);
    const external = [
      ...html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)="(https?:\/\/[^"]+)"/g)
    ].filter((m) => !/rel="canonical"/.test(m[0]) && !/property="og:/.test(m[0]));
    assert.deepEqual(
      external.map((m) => m[1]),
      [],
      `${p} loads external resources: ${external.map((m) => m[1]).join(", ")}`
    );
  }
});

/* A revenue claim is only acceptable as a disclaimer. Rather than banning the words, this
   checks that every sentence making one is negated — which is how index.html and
   request.html already word it ("No billing service can honestly guarantee higher
   reimbursement, and we don't."). */
test("no page promises higher revenue, higher codes or guaranteed results", () => {
  const claim = /\b(?:guarantee\w*|promis\w*|increase\w*|maximi[sz]\w*|boost\w*|more)\b[^.]{0,60}\b(?:revenue|reimbursement|collections|payment|codes?|paid)\b|\bcode (?:up|higher)\b|\bhigher (?:codes?|reimbursement|revenue)\b/i;
  const negation = /\b(?:no|not|never|don't|doesn't|won't|cannot|can't|nothing|neither|nor)\b/i;
  for (const p of Object.keys(PAGES)) {
    const text = read(p)
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ")
      .replace(/\s+/g, " ");
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (!claim.test(sentence)) continue;
      assert.ok(
        negation.test(sentence),
        `${p}: unqualified revenue/coding promise — "${sentence.trim().slice(0, 200)}"`
      );
    }
  }
});
