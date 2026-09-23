// #628 point 1: SearchIndex / EmbeddingIndex through find_affected_files itself (main dist), vs the grep set of #628.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
const [dist, tree] = process.argv.slice(2);
const cg = join(dist, "code-graph");
if (!existsSync(join(tree, "graphify-out", "graph.json"))) {
  const { buildCodeGraph } = await import(join(cg, "build.js"));
  const r = await buildCodeGraph({ repoRoot: tree, lowPriority: false });
  if (!r.ok) throw new Error(`build ${r.reason} ${r.detail}`);
}
const G = JSON.parse(readFileSync(join(tree, "graphify-out", "graph.json"), "utf8"));
console.log(`graph ${G.nodes.length} nodes / ${G.links.length} edges`);
const { CodeGraphCache } = await import(join(cg, "cache.js"));
const { findAffectedFiles } = await import(join(cg, "find-affected-files.js"));
const cache = new CodeGraphCache();
await cache.ensureLoaded(tree);
const files = new Map();
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  if (e.isDirectory()) { if (!["node_modules", "graphify-out", ".git", "dist"].includes(e.name)) walk(join(d, e.name)); }
  else if ([".ts", ".js", ".mjs"].some((x) => e.name.endsWith(x))) files.set(relative(tree, join(d, e.name)), readFileSync(join(d, e.name), "utf8")); } };
walk(tree);
for (const [name, src] of [["SearchIndex", "packages/core/src/search.ts"], ["EmbeddingIndex", "packages/core/src/embeddings.ts"]]) {
  const use = new RegExp(`\\b${name}\\s*\\(|import\\s*\\{[^}]*\\b${name}\\b|from\\s+\\S+\\s+import[^\\n]*\\b${name}\\b`);
  const grep = new Set([...files].filter(([p, b]) => p !== src && new Set(b.match(/[A-Za-z_]\w+/g)).has(name) && use.test(b)).map(([p]) => p));
  for (const depth of [1, 2]) {
    const r = await findAffectedFiles(cache, { file: src, symbols: [name], repo: tree, depth });
    const got = new Set(r.files);
    const both = [...grep].filter((f) => got.has(f));
    const rel = {}; for (const h of r.hits) rel[h.relation] = (rel[h.relation] ?? 0) + 1;
    console.log(`${name} (${src}) depth ${depth}: status ${r.status}, affected ${r.files.length} files${r.truncated ? " (TRUNCATED)" : ""}, grep ${grep.size}, both ${both.length} (${(100 * both.length / grep.size).toFixed(0)}%) relations ${JSON.stringify(rel)} unknown=${JSON.stringify(r.unknown_symbols ?? [])}`);
  }
}
// Uncapped: the same hits find_affected_files starts from, before affectedResult's cap of MAX_AFFECTED_FILES.
const { affectedHits, narrowPackageHits, symbolsNamed, MAX_AFFECTED_FILES } = await import(join(cg, "affected.js"));
const graph = cache.get(tree);
for (const [name, src] of [["SearchIndex", "packages/core/src/search.ts"], ["EmbeddingIndex", "packages/core/src/embeddings.ts"]]) {
  const use = new RegExp(`\\b${name}\\s*\\(|import\\s*\\{[^}]*\\b${name}\\b|from\\s+\\S+\\s+import[^\\n]*\\b${name}\\b`);
  const grep = new Set([...files].filter(([p, b]) => p !== src && new Set(b.match(/[A-Za-z_]\w+/g)).has(name) && use.test(b)).map(([p]) => p));
  const { found } = symbolsNamed(graph, src, [name]);
  const hits = await narrowPackageHits(tree, affectedHits(graph, src, found, 1), [name]);
  const all = new Set(hits.map((h) => h.file));
  const both = [...grep].filter((f) => all.has(f));
  const miss = [...grep].filter((f) => !all.has(f));
  const kinds = {}; for (const f of miss) { const k = /__tests__|\.test\./.test(f) ? "test" : "src"; kinds[k] = (kinds[k] ?? 0) + 1; }
  console.log(`UNCAPPED ${name}: affected ${all.size} files (cap ${MAX_AFFECTED_FILES}), grep ${grep.size}, both ${both.length} (${(100 * both.length / grep.size).toFixed(0)}%), grep-only ${miss.length} ${JSON.stringify(kinds)} e.g. ${miss.slice(0, 3).join(", ")}`);
}
