/* Extracts the ==CORE== block out of tools/timely-filing.html and evaluates it in an
   isolated context, so the pure filing-deadline logic can be tested without a browser.
   The markers exist in the page for exactly this reason. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function extract(relPath) {
  const file = path.resolve(import.meta.dirname, "..", relPath);
  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf("/* ==BEGIN CORE== */");
  const end = html.indexOf("/* ==END CORE== */");
  if (start === -1 || end === -1) throw new Error("CORE markers not found in " + relPath);
  return html.slice(start, end);
}

function run(relPath, exportExpr) {
  const ctx = vm.createContext({});
  vm.runInContext(extract(relPath) + "\n;this.__core = " + exportExpr + ";", ctx);
  return ctx.__core;
}

export function loadCore() {
  return run("tools/timely-filing.html",
    "{ evaluate: evaluate, PAYERS: PAYERS, findPayer: findPayer }");
}

export function loadRequestCore() {
  return run("request.html",
    "{ composeRequest: composeRequest, ADDRESS: ADDRESS, MAILTO_MAX: MAILTO_MAX, FIELD_ORDER: FIELD_ORDER }");
}
