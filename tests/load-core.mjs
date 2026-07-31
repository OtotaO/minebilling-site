/* Extracts the ==CORE== block out of tools/timely-filing.html and evaluates it in an
   isolated context, so the pure filing-deadline logic can be tested without a browser.
   The markers exist in the page for exactly this reason. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export function loadCore() {
  const file = path.resolve(import.meta.dirname, "../tools/timely-filing.html");
  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf("/* ==BEGIN CORE== */");
  const end = html.indexOf("/* ==END CORE== */");
  if (start === -1 || end === -1) throw new Error("CORE markers not found in timely-filing.html");
  const src = html.slice(start, end);
  const ctx = vm.createContext({});
  vm.runInContext(src + "\n;this.__core = { evaluate: evaluate, PAYERS: PAYERS, findPayer: findPayer };", ctx);
  return ctx.__core;
}
