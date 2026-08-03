/* Regression tests for request.html — the site's only conversion path.
   A5-04: the contact address must exist outside the JavaScript, and a failed mailto: must
          not lose the lead silently.
   A5-05: the "no patient information" warning must be an emphasised .warn panel ABOVE the
          send button, not fineprint below it.
   A5-10: a long answer must not produce a mailto: URL that mail clients silently truncate.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadRequestCore } from "./load-core.mjs";

const FILE = path.resolve(import.meta.dirname, "../request.html");
const html = fs.readFileSync(FILE, "utf8");
const { composeRequest, ADDRESS, MAILTO_MAX, FIELD_ORDER } = loadRequestCore();

const markup = html.slice(0, html.indexOf("<script>"));

/* ---- A5-04 ---- */

test("A5-04: the contact address appears in the markup, not only in the script", () => {
  assert.ok(markup.includes(ADDRESS), "address is missing from the page body");
  assert.ok(markup.includes('href="mailto:' + ADDRESS + '"'), "no mailto: link in the markup");
});

test("A5-04: a copyable fallback message exists for machines with no mail handler", () => {
  assert.ok(markup.includes('id="fallback"'), "fallback container missing");
  assert.ok(markup.includes('id="composed"'), "copyable textarea missing");
  assert.ok(markup.includes('id="copy"'), "copy button missing");
  assert.match(html, /composed\.value = msg\.plain;\s*\n\s*fallback\.hidden = false;/,
    "the click handler no longer reveals the copyable message");
});

test("A5-04: the composed plain text carries the address and subject", () => {
  const msg = composeRequest({ clinic: "Lakeview Family Medicine" });
  assert.ok(msg.plain.startsWith("To: " + ADDRESS + "\n"));
  assert.ok(msg.plain.includes("Subject: Free billing scorecard request — Lakeview Family Medicine"));
  assert.ok(msg.plain.includes(msg.body));
});

/* ---- A5-05 ---- */

test("A5-05: the no-patient-information warning is a .warn panel above the send button", () => {
  const warnAt = markup.indexOf("Please don't include any patient information in your email");
  const btnAt = markup.indexOf('id="send"');
  assert.notEqual(warnAt, -1, "the warning text is gone");
  assert.notEqual(btnAt, -1, "the send button is gone");
  assert.ok(warnAt < btnAt, "the warning still renders below the send button");
  const panelAt = markup.lastIndexOf('class="warn"', warnAt);
  assert.notEqual(panelAt, -1, "the warning is not inside a .warn panel");
  assert.ok(warnAt - panelAt < 200, "the nearest .warn panel is not the one wrapping the warning");
});

test("A5-05: the warning is still the first line of the composed email body", () => {
  const msg = composeRequest({});
  assert.equal(msg.body.split("\n")[0],
    "Please don't include any patient information in this email.");
});

/* ---- A5-10 ---- */

test("A5-10: free-text fields are length-capped", () => {
  for (const id of ["clinic", "who", "state", "pms", "notes"]) {
    assert.match(
      markup,
      new RegExp('<input type="text" id="' + id + '" maxlength="\\d+"'),
      "#" + id + " has no maxlength"
    );
  }
});

test("A5-10: an over-long body is not handed to the mail client", () => {
  const msg = composeRequest({ notes: "x".repeat(4000), clinic: "y".repeat(300) });
  assert.equal(msg.tooLong, true);
  assert.ok(msg.mailto.length > MAILTO_MAX);
});

test("A5-10: a normal-length request is still handed to the mail client", () => {
  const msg = composeRequest({
    clinic: "Lakeview Family Medicine",
    who: "Dr. Patel, owner",
    state: "Illinois",
    providers: "3",
    pms: "eClinicalWorks",
    billing: "In-house staff",
    pain: "Denials and rework",
    notes: "We are seeing a lot of CO-16 rejections since April."
  });
  assert.equal(msg.tooLong, false);
  assert.ok(msg.mailto.length < MAILTO_MAX, "unexpectedly long: " + msg.mailto.length);
});

test("A5-10: maxlength values keep a fully-filled form under the mailto ceiling", () => {
  const caps = {};
  for (const id of FIELD_ORDER) {
    const m = markup.match(new RegExp('id="' + id + '"[^>]*maxlength="(\\d+)"'));
    caps[id] = m ? "x".repeat(Number(m[1])) : "200";
  }
  assert.equal(composeRequest(caps).tooLong, false,
    "the maxlength values still allow a form that overflows the mailto ceiling");
});

/* ---- composition behaviour that must not regress ---- */

test("empty form still produces a usable message", () => {
  const msg = composeRequest({});
  assert.ok(msg.body.includes("(no details provided — happy to talk it through)"));
  assert.equal(msg.subject, "Free billing scorecard request");
  assert.equal(msg.tooLong, false);
});

test("header injection through a free-text field is neutralised", () => {
  const msg = composeRequest({ notes: "&cc=evil@example.com&subject=Hacked" });
  assert.equal(msg.mailto.split("?").length, 2, "more than one '?' in the mailto URL");
  assert.ok(msg.mailto.includes("%26cc%3D"), "the injected & and = were not encoded");
  assert.equal((msg.mailto.match(/&body=/g) || []).length, 1);
  assert.ok(!/[?&]cc=/.test(msg.mailto), "a cc header survived encoding");
});
