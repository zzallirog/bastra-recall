// Lab #629, function level: test -> file -> named functions that RAN (count > 0).
// The module body (functions[0]) and esbuild's `__name` helper run on import in every module, so neither
// counts: with them in, "called into the file" equals "loaded" (found and fixed 09-23). Anonymous functions
// cannot be matched by name across commits and are left out of the function map.
// Keyed by NAME, not line: names survive edits, so a map folded at one commit still reads at the next.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const [covDir, root, out] = process.argv.slice(2);
const base = root.replace(/\/$/, "");
const procs = new Map();
for (const l of readFileSync(join(covDir, "procs.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const p = JSON.parse(l);
  procs.set(p.pid, p);
}
const map = {}; // test -> file -> Set(fn)
const files = {}; // test -> Set(file) where any named function ran
for (const f of readdirSync(covDir).filter((f) => f.startsWith("coverage-") && f.endsWith(".json"))) {
  const test0 = procs.get(Number(f.split("-")[1]))?.test;
  if (!test0) continue;
  const test = test0.startsWith("/") ? test0.slice(base.length + 1) : test0;
  let data;
  try { data = JSON.parse(readFileSync(join(covDir, f), "utf8")); } catch { continue; }
  for (const s of data.result ?? []) {
    if (!s.url?.startsWith("file://" + base + "/") || s.url.includes("/node_modules/")) continue;
    const path = fileURLToPath(s.url).slice(base.length + 1).replace(/^packages\/([^/]+)\/dist\/(.+)\.js$/, "packages/$1/src/$2.ts");
    for (const fn of (s.functions ?? []).slice(1)) {
      if (fn.functionName === "" || fn.functionName === "__name") continue;
      if ((fn.ranges?.[0]?.count ?? 0) === 0) continue;
      ((map[test] ??= {})[path] ??= new Set()).add(fn.functionName);
    }
  }
}
const json = Object.fromEntries(Object.entries(map).map(([t, byFile]) => [t, Object.fromEntries(Object.entries(byFile).map(([p, s]) => [p, [...s].sort()]))]));
writeFileSync(out, JSON.stringify(json));
const pairs = Object.values(json).reduce((n, byFile) => n + Object.keys(byFile).length, 0);
console.log(`tests ${Object.keys(json).length}, (test, file) pairs where a named function ran: ${pairs}`);
