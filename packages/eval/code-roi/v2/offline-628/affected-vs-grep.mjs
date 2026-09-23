// #628's graph-vs-grep population (1,558 symbols at fa76661), re-scored through find_affected_files' own hits.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
const [dist, tree] = process.argv.slice(2);
const cg = join(dist, "code-graph");
const G = JSON.parse(readFileSync(join(tree, "graphify-out", "graph.json"), "utf8"));
const { CodeGraphCache } = await import(join(cg, "cache.js"));
const { affectedHits, narrowPackageHits, symbolsNamed, affectedResult } = await import(join(cg, "affected.js"));
const cache = new CodeGraphCache();
await cache.ensureLoaded(tree);
const graph = cache.get(tree);
const files = new Map();
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  if (e.isDirectory()) { if (!["node_modules", "graphify-out", ".git", "dist"].includes(e.name)) walk(join(d, e.name)); }
  else if ([".ts", ".js", ".mjs"].some((x) => e.name.endsWith(x))) { const b = readFileSync(join(d, e.name), "utf8"); files.set(relative(tree, join(d, e.name)), [new Set(b.match(/[A-Za-z_]\w+/g)), b]); } } };
walk(tree);
const N = new Map(G.nodes.map((n) => [n.id, n]));
const DEP = new Set(["calls", "imports", "imports_from", "inherits", "re_exports", "dynamic_import", "implements"]);
const bare = (l) => String(l ?? "").replace(/\(\)$/, "");
const labelCount = new Map();
for (const n of G.nodes) if (n._callable) labelCount.set(bare(n.label), (labelCount.get(bare(n.label)) ?? 0) + 1);
const into = new Map();
for (const e of G.links) {
  if (!DEP.has(e.relation) || e.confidence !== "EXTRACTED") continue;
  const s = N.get(e.source) ?? {}, t = N.get(e.target) ?? {};
  if (s.source_file && s.source_file !== t.source_file) { if (!into.has(e.target)) into.set(e.target, new Set()); into.get(e.target).add(s.source_file); }
}
let rows = 0, g = 0, direct = 0, unc = 0, cap = 0, zeroDirect = 0, zeroUnc = 0, zeroCap = 0, extraUnc = 0, truncated = 0;
const esc = (s) => s.replace(/[$]/g, "\\$");
for (const n of G.nodes) {
  const name = bare(n.label), src = n.source_file;
  if (!n._callable || name.length < 8 || labelCount.get(name) !== 1 || !files.has(src) || !/^[A-Za-z_]\w+$/.test(name)) continue;
  const use = new RegExp(`\\b${esc(name)}\\s*\\(|import\\s*\\{[^}]*\\b${esc(name)}\\b|from\\s+\\S+\\s+import[^\\n]*\\b${esc(name)}\\b`);
  const grep = [...files].filter(([p, [w, b]]) => p !== src && w.has(name) && use.test(b)).map(([p]) => p);
  if (grep.length === 0) continue;
  rows++; g += grep.length;
  const d = into.get(n.id) ?? new Set();
  const { found } = symbolsNamed(graph, src, [name]);
  const hits = await narrowPackageHits(tree, affectedHits(graph, src, found, 1), [name]);
  const all = new Set(hits.map((h) => h.file));
  const res = affectedResult(found, hits);
  const capped = new Set(res.files);
  if (res.truncated) truncated++;
  const hd = grep.filter((f) => d.has(f)).length, hu = grep.filter((f) => all.has(f)).length, hc = grep.filter((f) => capped.has(f)).length;
  direct += hd; unc += hu; cap += hc;
  zeroDirect += hd === 0; zeroUnc += hu === 0; zeroCap += hc === 0;
  extraUnc += [...all].filter((f) => !grep.includes(f)).length;
}
const pct = (x) => `${(100 * x / g).toFixed(0)}%`;
console.log(`${rows} symbols, ${g} grep files`);
console.log(`direct edges into the symbol (#628): ${direct}/${g} (${pct(direct)}), none for ${zeroDirect}`);
console.log(`find_affected_files hits, uncapped: ${unc}/${g} (${pct(unc)}), none for ${zeroUnc}; files beyond grep ${extraUnc}`);
console.log(`find_affected_files answer (cap 40): ${cap}/${g} (${pct(cap)}), none for ${zeroCap}; truncated answers ${truncated}`);
