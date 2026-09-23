// Lab #629 scoring: for each scenario, the tests the coverage map names, at file level and at function level.
// usage: node score-fn.mjs <pin checkout> <map-fn.json> <merged.jsonl> <edge-sources out dir> <repo>
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const [pin, mapPath, mergedPath, evalOut, repo] = process.argv.slice(2);
const v2 = join(pin, "packages/eval/code-roi/v2");
const cg = join(pin, "packages/daemon/dist/code-graph");
const { scenarioRoot } = await import(join(v2, "scenario-root.mjs"));
const { diffForTree } = await import(join(v2, "diff-side.mjs"));
const { loadGraph } = await import(join(cg, "reader.js"));
const { changedSymbolsOf } = await import(join(cg, "affected.js"));
const map = JSON.parse(readFileSync(mapPath, "utf8"));
const rows = new Map(JSON.parse(readFileSync(join(evalOut, "edge-sources.json"), "utf8")).rows.map((r) => [`${r.commit}:${r.file}`, r]));
const accepted = readFileSync(mergedPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.accepted);
const bare = (n) => String(n).replace(/\(\)$/, "").split(".").pop();
const tot = { file: [0, 0, 0], fn: [0, 0, 0] }; // covers, named, blocks
for (const s of accepted) {
  const row = rows.get(`${s.commit}:${s.file}`);
  if (!row?.delivered) continue;
  const dir = join(evalOut, "trees", s.parent);
  const loaded = await loadGraph(scenarioRoot(join(dir, "tree"), join(dir, "graph")));
  const changed = loaded.ok ? changedSymbolsOf(loaded.graph, s.file, diffForTree(s.diff, "old")).map((c) => bare(c.name)) : [];
  const existing = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", s.parent], { cwd: repo, encoding: "utf8" }).split("\n"));
  const byFile = [], byFn = [];
  for (const [t, files] of Object.entries(map)) {
    if (!existing.has(t) || !files[s.file]) continue;
    byFile.push(t);
    if (files[s.file].some((f) => changed.includes(f))) byFn.push(t);
  }
  for (const [k, named] of [["file", byFile], ["fn", byFn]]) {
    const hit = s.truth.filter((t) => named.includes(t)).length;
    tot[k][0] += hit > 0; tot[k][1] += named.length; tot[k][2]++;
  }
  const hitFn = s.truth.filter((t) => byFn.includes(t));
  console.log(`${s.file.split("/").pop()}: changed [${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""}] file-level ${byFile.length} tests, function-level ${byFn.length} tests; truth ${hitFn.length}/${s.truth.length} ${hitFn.length ? "" : "MISSED " + s.truth.map((t) => t.split("/").pop()).join(",")}`);
}
for (const [k, [c, n, b]] of Object.entries(tot)) console.log(`${k === "file" ? "file level (a named function of the file ran)" : "function level (a CHANGED function ran)"}: names a truth test in ${c}/${b} blocks, ${(n / Math.max(1, b)).toFixed(1)} tests per block`);
