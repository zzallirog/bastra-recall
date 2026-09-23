/**
 * Offline: do a name index and co-change history lift the delivered block (#628)?
 *
 * THE QUESTION, as the maintainer put it on #628: before any further agent
 * run, settle whether better edges clearly improve coverage — from 15/37 to at
 * least 25/37 delivered blocks naming a truth file, without losing correct
 * files. The population is the delivered one (`code-awareness-delivered`,
 * registration 3, `tests/v2`); no agent runs here, only the block.
 *
 * THE GRAPH LINES ARE THE PRODUCT'S, NOT A REPLICA. Each scenario's block comes
 * from `deliveredBlockFor` in the checkout named by `--product`, which must be
 * the pinned build (973c6b8c) with its `dist` built: the same call the runner
 * made, against the same prompt (`promptFor`) and a graph built by the same
 * `buildGraph`. The report refuses to call a result comparable when the
 * product's frozen-surface hashes differ from the registration's.
 *
 * THE TWO NEW SOURCES, exactly as #628 proposes them — two more labelled lines
 * in the existing block, built at refresh time, never required:
 *
 *   NAME — for each symbol the block itself resolved (`changedSymbols`), the
 *     code files that call it by name (`name(`) or import it (`import { name }`)
 *     and that the block did not list. Distinctive names only: at least 8
 *     characters and exactly one node with that label in the graph. Read from
 *     the scenario tree, i.e. the refresh-time state, never from the diff.
 *   HISTORY — `co_changed(file, partner)` from `git log --no-merges` up to the
 *     scenario's PARENT commit, so a scenario never sees its own change. Only
 *     partners OUTSIDE the code-only graph, as proposed: that is where the
 *     graph is blind by construction.
 *
 * THE PARAMETERS ARE FIXED HERE, BEFORE THE FIRST RUN, and not tuned on this
 * population: the name guard and the history thresholds are the ones #628
 * published (support >= 2, confidence >= 0.3, top 3 — the second row of its
 * table), the name cap is five lines. Variants that break the proposal's own
 * rules (history over code partners, the name lines uncapped, the graph's full
 * candidate list instead of the ten it shows) are reported as DIAGNOSTICS: they
 * say where the headroom is, they are not the proposal.
 *
 * WHAT COUNTS. A block covers a scenario when at least one file it names is in
 * the scenario's truth set — the registration's `blocks_naming_a_truth_file`,
 * 15 of 37 on the pinned build. The new lines only ADD files, so a correct file
 * can only be lost through a bug; that is checked per scenario, not assumed.
 * The price is reported next to it: files added that are not truth, and the
 * block's estimated tokens.
 *
 * Usage:
 *   node edge-sources.mjs --product <checkout at the pinned build, dist built>
 *     --repo <git repository holding the scenario commits>
 *     (--scenarios <scenarios.json> | --candidates <candidates.jsonl>)
 *     --out <work dir> [--graphify <graphify binary>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/** #628's guard: a name shorter than this matches too much to mean a caller. */
export const MIN_NAME_LENGTH = 8;
/** Name lines added to one block, at most. */
export const MAX_NAME_FILES = 5;
/** History thresholds, #628's table row 2: support, confidence, top K per file. */
export const HISTORY = { support: 2, confidence: 0.3, topK: 3 };
/** Commits with more files than this say little about any one pair (#628). */
export const MAX_COMMIT_FILES = 30;

const SOURCE_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx"];
const SKIP_DIRS = new Set(["node_modules", "dist", "graphify-out", ".git"]);

// ─── Name index ──────────────────────────────────────────────────

/** A graph label without the `()` graphify appends to callables. */
export function bareLabel(label) {
  return String(label ?? "").replace(/\(\)$/, "");
}

/**
 * Names that are distinctive enough to stand for one definition: long enough,
 * a plain identifier, and the label of exactly one code node in the graph. A
 * name defined twice would make every caller of the other one a false line.
 */
export function distinctiveNames(symbols, graph) {
  const count = new Map();
  for (const n of graph.nodes ?? []) {
    if (!n.source_file) continue;
    const name = bareLabel(n.label);
    count.set(name, (count.get(name) ?? 0) + 1);
  }
  return [...new Set(symbols)].filter(
    (s) => s.length >= MIN_NAME_LENGTH && /^[A-Za-z_$][\w$]*$/.test(s) && count.get(s) === 1,
  );
}

/** `name(` or `import { …name… }` — the same test #628's measurement used. */
export function usesByName(body, name) {
  const n = name.replace(/\$/g, "\\$");
  return new RegExp(`\\b${n}\\s*\\(|import\\s*\\{[^}]*\\b${n}\\b`).test(body);
}

/** Every code file of a tree, repo-relative, with its text. */
export function codeFilesOf(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && SOURCE_EXTS.some((e) => entry.name.endsWith(e))) {
        const p = join(dir, entry.name);
        out.set(relative(root, p), readFileSync(p, "utf8"));
      }
    }
  };
  walk(root);
  return out;
}

/**
 * The name lines for one block: files that use a changed name and are not the
 * changed file and not already listed. Ordered by how many of the changed names
 * a file uses, then by path — nothing about tests, nothing about truth.
 */
export function nameLines({ names, files, changedFile, listed, cap = MAX_NAME_FILES }) {
  const skip = new Set([changedFile, ...listed]);
  const hits = [];
  for (const [path, body] of files) {
    if (skip.has(path)) continue;
    const used = names.filter((n) => body.includes(n) && usesByName(body, n));
    if (used.length > 0) hits.push({ file: path, names: used });
  }
  hits.sort((a, b) => b.names.length - a.names.length || a.file.localeCompare(b.file));
  return cap === Infinity ? hits : hits.slice(0, cap);
}

// ─── Co-change history ───────────────────────────────────────────

/** Non-merge commits up to `rev`, oldest first, as lists of paths. */
export function commitFilesUpTo(repo, rev) {
  const log = execFileSync("git", ["log", rev, "--no-merges", "--reverse", "--format=@@%H", "--name-only"], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return log
    .split("@@")
    .slice(1)
    .map((block) => [...new Set(block.split("\n").slice(1).filter((l) => l.trim() !== ""))]);
}

/** Pair and single change counts over commits of 2..MAX_COMMIT_FILES files. */
export function coChangeCounts(commits) {
  const changes = new Map();
  const pairs = new Map();
  for (const files of commits) {
    if (files.length < 2 || files.length > MAX_COMMIT_FILES) continue;
    for (const f of files) changes.set(f, (changes.get(f) ?? 0) + 1);
    for (const a of files) {
      let row = pairs.get(a);
      if (row === undefined) pairs.set(a, (row = new Map()));
      for (const b of files) if (a !== b) row.set(b, (row.get(b) ?? 0) + 1);
    }
  }
  return { changes, pairs };
}

/**
 * History lines for one file: partners with enough support and confidence,
 * best confidence first, top K. `keep` decides which partners are eligible —
 * the proposal keeps only files outside the code-only graph.
 */
export function historyLines({ counts, file, keep, skip, params = HISTORY }) {
  const n = counts.changes.get(file) ?? 0;
  const row = counts.pairs.get(file);
  if (n === 0 || row === undefined) return [];
  const out = [];
  for (const [partner, support] of row) {
    if (skip.has(partner) || !keep(partner)) continue;
    const confidence = support / n;
    if (support >= params.support && confidence >= params.confidence) {
      out.push({ file: partner, support, changes: n, confidence });
    }
  }
  out.sort((a, b) => b.confidence - a.confidence || b.support - a.support || a.file.localeCompare(b.file));
  return out.slice(0, params.topK);
}

// ─── The block with the two new lines ────────────────────────────

/** The block as the lane would print it with both lines switched on. */
export function renderWithSources(note, byName, byHistory) {
  const extra = [];
  if (byName.length > 0) {
    extra.push("By name (name match, unverified):");
    for (const h of byName) extra.push(`- ${h.file} — uses ${h.names.join(", ")}`);
  }
  if (byHistory.length > 0) {
    extra.push("Changed together before (history, paths only):");
    for (const h of byHistory) extra.push(`- ${h.file} — ${h.support} of ${h.changes} changes`);
  }
  if (extra.length === 0) return note;
  return note.replace(/\n<\/code-impact>$/, `\n${extra.join("\n")}\n</code-impact>`);
}

/**
 * Relative imports the diff ADDS that resolve to no file of the parent tree.
 *
 * A scenario applies exactly one file's diff. When the commit also created the
 * module that diff imports, the mutated tree imports a file that is not there,
 * and every test that loads the module fails with "Cannot find module" — found
 * on 09-23 by reproducing `session-assembler.test.ts` breaking under the
 * `prompt-lane.ts` change of a1a96db3, a test that on a healthy tree never calls
 * into prompt-lane at all. That truth is real under the registered rule, but no
 * edge source can name it: the graph of the parent has no such file, and the
 * test is coupled to the change by load order, not by a name, a history or a
 * call. So every total is also reported split on this flag.
 */
export function danglingImports(diff, file, parentFiles) {
  const out = [];
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  for (const line of String(diff ?? "").split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const m of line.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
      const p = normalizeRel(dir, m[1]);
      const cands = [p, p.replace(/\.js$/, ".ts"), p.replace(/\.mjs$/, ".mts"), `${p}.ts`, `${p}/index.ts`];
      if (!cands.some((c) => parentFiles.has(c))) out.push(m[1]);
    }
  }
  return [...new Set(out)];
}

function normalizeRel(dir, spec) {
  const parts = dir === "" ? [] : dir.split("/");
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/** Coverage and cost of one arm on one scenario. */
export function scoreArm(named, truth, graphListed) {
  const set = new Set(named);
  const hit = truth.filter((t) => set.has(t));
  const graphHit = truth.filter((t) => graphListed.includes(t));
  return {
    covers: hit.length > 0,
    truthNamed: hit.length,
    lost: graphHit.filter((t) => !set.has(t)),
    extra: [...set].filter((f) => !truth.includes(f) && !graphListed.includes(f)).length,
  };
}

// ─── Driver ──────────────────────────────────────────────────────

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : null;
}

/** Scenarios from a `select.mjs` file, or the miner's accepted records in order. */
export function loadScenarios({ scenarios, candidates }) {
  if (scenarios !== null) {
    return JSON.parse(readFileSync(scenarios, "utf8")).scenarios.filter((s) => !s.excluded);
  }
  const accepted = readFileSync(candidates, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.accepted === true);
  return accepted.map((r, i) => ({ id: `S${String(i + 1).padStart(2, "0")}`, ...r }));
}

function treeFor(repo, s, dir) {
  const tree = join(dir, "tree");
  const graphRoot = join(dir, "graph");
  if (existsSync(join(graphRoot, "graphify-out", "graph.json")) && existsSync(tree)) return { tree, graphRoot };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(tree, { recursive: true });
  mkdirSync(graphRoot, { recursive: true });
  const tar = execFileSync("git", ["archive", "--format=tar", s.parent], { cwd: repo, maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", tree], { input: tar, maxBuffer: 1 << 30 });
  rmSync(join(tree, ".claude"), { recursive: true, force: true });
  return { tree, graphRoot };
}

async function main() {
  const product = argOf("--product");
  const repo = argOf("--repo");
  const out = argOf("--out");
  if (product === null || repo === null || out === null) {
    throw new Error("usage: edge-sources.mjs --product <dir> --repo <dir> (--scenarios f | --candidates f) --out <dir>");
  }
  if (argOf("--graphify") !== null) process.env.BASTRA_GRAPHIFY_BIN = argOf("--graphify");
  const v2 = join(product, "packages", "eval", "code-roi", "v2");
  const { deliveredBlockFor, listedFilesOf } = await import(join(v2, "delivered-block.mjs"));
  const { buildGraph, promptFor } = await import(join(v2, "run-arms.mjs"));
  const { scenarioRoot } = await import(join(v2, "scenario-root.mjs"));
  const { deliveredSurfaceHashesFromDist } = await import(join(v2, "build-pin.mjs"));
  const registration = JSON.parse(
    readFileSync(join(product, "packages", "eval", "registrations", "code-awareness-delivered.json"), "utf8"),
  );
  const surface = await deliveredSurfaceHashesFromDist(join(product, "packages", "daemon", "dist"));
  const frozen = registration.arms.frozen_surface;
  const surfaceMatches = Object.keys(surface).every((k) => surface[k] === frozen[k]);

  const scenarios = loadScenarios({ scenarios: argOf("--scenarios"), candidates: argOf("--candidates") });
  mkdirSync(out, { recursive: true });
  const historyCache = new Map();
  const rows = [];
  for (const s of scenarios) {
    // Keyed by the parent commit, not the id: the tree and its graph depend on
    // nothing else, and ids shift whenever a scenario is added or dropped.
    const dir = join(out, "trees", s.parent);
    const { tree, graphRoot } = treeFor(repo, s, dir);
    await buildGraph(tree, graphRoot);
    const block = await deliveredBlockFor(s, tree, graphRoot, promptFor(s));
    const graph = JSON.parse(readFileSync(join(graphRoot, "graphify-out", "graph.json"), "utf8"));
    const inGraph = new Set((graph.nodes ?? []).map((n) => n.source_file).filter(Boolean));
    const truth = s.truth ?? [];
    const row = { id: s.id, commit: s.commit, file: s.file, truth, blindSpots: s.blindSpots ?? [] };

    const listed = block === null ? [] : [...new Set(listedFilesOf(block.note))];
    const names = block === null ? [] : distinctiveNames(block.changedSymbols, graph);
    const files = codeFilesOf(tree);
    const target = block?.note?.match(/<code-impact file="([^"]+)"/)?.[1] ?? s.file;

    if (!historyCache.has(s.parent)) historyCache.set(s.parent, coChangeCounts(commitFilesUpTo(repo, s.parent)));
    const counts = historyCache.get(s.parent);

    const byName = nameLines({ names, files, changedFile: target, listed });
    const byNameAll = nameLines({ names, files, changedFile: target, listed, cap: Infinity });
    const skipH = new Set([target, ...listed, ...byName.map((h) => h.file)]);
    const byHistory = historyLines({ counts, file: target, keep: (p) => !inGraph.has(p), skip: skipH });
    const byHistoryAny = historyLines({ counts, file: target, keep: () => true, skip: skipH });
    // The graph's whole candidate list, before the display cap of ten: the
    // product's own `find_affected_files` answer at the same depth.
    const graphAll = block === null ? [] : await graphCandidates(product, scenarioRoot(tree, graphRoot), block, target);

    const withName = [...listed, ...byName.map((h) => h.file)];
    const withHistory = [...listed, ...byHistory.map((h) => h.file)];
    const both = [...withName, ...byHistory.map((h) => h.file)];
    row.danglingImports = danglingImports(s.diff, s.file, new Set(files.keys()));
    row.delivered = block !== null;
    row.basis = block?.basis ?? null;
    row.changedSymbols = block?.changedSymbols ?? [];
    row.distinctiveNames = names;
    row.listed = listed;
    row.byName = byName;
    row.byHistory = byHistory;
    row.byHistoryAny = byHistoryAny;
    row.arms = {
      graph: scoreArm(listed, truth, listed),
      graph_name: scoreArm(withName, truth, listed),
      graph_history: scoreArm(withHistory, truth, listed),
      graph_name_history: scoreArm(both, truth, listed),
      diag_graph_uncapped: scoreArm(graphAll, truth, listed),
      diag_name_uncapped: scoreArm([...listed, ...byNameAll.map((h) => h.file)], truth, listed),
      diag_history_any: scoreArm([...withName, ...byHistoryAny.map((h) => h.file)], truth, listed),
    };
    const closure = staticClosureArm(s);
    if (closure !== null) row.arms.diag_static_closure = closure;
    row.tokens = {
      graph: block === null ? 0 : Math.ceil(block.note.length / 4),
      graph_name_history: block === null ? 0 : Math.ceil(renderWithSources(block.note, byName, byHistory).length / 4),
    };
    if (block !== null) {
      const name = `block-${s.file.replace(/[^\w.-]+/g, "_")}.txt`;
      writeFileSync(join(dir, name), renderWithSources(block.note, byName, byHistory));
    }
    rows.push(row);
    process.stdout.write(
      `${s.id} ${block === null ? "silent" : `${listed.length} listed`} truth=${truth.length} ` +
        `graph=${row.arms.graph.covers ? 1 : 0} +name=${row.arms.graph_name.covers ? 1 : 0} ` +
        `+hist=${row.arms.graph_history.covers ? 1 : 0}\n`,
    );
  }

  const report = summarize(rows, { surface, surfaceMatches, scenarios: scenarios.length });
  writeFileSync(join(out, "edge-sources.json"), JSON.stringify({ report, rows }, null, 2));
  process.stdout.write(`\n${formatReport(report)}\n`);
}

/**
 * The product's full candidate list for the block's own target and symbols, at
 * the block's depth (1), before `displayOrder` cuts it to ten — the ceiling
 * the graph lines could reach if nothing but the cap stood in the way. It is
 * `find_affected_files`, the tool the block's own "… and N more" line names.
 */
async function graphCandidates(product, repoRoot, block, target) {
  const dist = join(product, "packages", "daemon", "dist", "code-graph");
  const { CodeGraphCache } = await import(join(dist, "cache.js"));
  const { findAffectedFiles } = await import(join(dist, "find-affected-files.js"));
  const cache = new CodeGraphCache();
  await cache.ensureLoaded(repoRoot);
  const symbols = block.basis === "symbols" ? block.changedSymbols : undefined;
  const result = await findAffectedFiles(cache, { file: target, symbols, repo: repoRoot, depth: 1 });
  return result.files;
}

/**
 * DIAGNOSTIC, AND CIRCULAR BY CONSTRUCTION: every test whose static import
 * closure contains the changed file, read off the miner's own record
 * (`testSelection.reached`, `blindSpots`). The truth was selected from exactly
 * these tests with the same parser, so this arm names every truth file that is
 * not a blind spot and cannot be beaten on coverage. What it shows is the other
 * side — how many tests such a static test → file index would print to get
 * there — which is the comparison #629 has to win.
 */
export function staticClosureArm(s) {
  const reached = s.testSelection?.reached;
  if (typeof reached !== "number") return null;
  const truth = s.truth ?? [];
  const blind = new Set(s.blindSpots ?? []);
  const named = truth.filter((t) => !blind.has(t)).length;
  return { covers: named > 0, truthNamed: named, lost: [], extra: Math.max(0, reached - named) };
}

/** Totals over the delivered blocks (the registration's denominator) and over the silent ones. */
export function summarize(rows, meta) {
  const delivered = rows.filter((r) => r.delivered);
  const silent = rows.filter((r) => !r.delivered);
  const dangling = (r) => (r.danglingImports?.length ?? 0) > 0;
  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? 0 : s[Math.floor((s.length - 1) / 2)];
  };
  return {
    ...meta,
    delivered: delivered.length,
    silent: silent.map((r) => r.id),
    parameters: { MIN_NAME_LENGTH, MAX_NAME_FILES, HISTORY, MAX_COMMIT_FILES },
    tokens_median: {
      graph: med(delivered.map((r) => r.tokens.graph)),
      graph_name_history: med(delivered.map((r) => r.tokens.graph_name_history)),
    },
    totals: totalsOf(rows),
    // The same arms, split on whether the diff imports a module its parent
    // tree does not have (`danglingImports`): a diagnostic, not a filter.
    split: {
      dangling_import: { scenarios: rows.filter(dangling).map((r) => r.id), totals: totalsOf(rows.filter(dangling)) },
      clean: { scenarios: rows.filter((r) => !dangling(r)).map((r) => r.id), totals: totalsOf(rows.filter((r) => !dangling(r))) },
    },
  };
}

/** Per-arm totals over the delivered blocks of `rows`, and what each arm names where the graph is silent. */
function totalsOf(rows) {
  const delivered = rows.filter((r) => r.delivered);
  const silent = rows.filter((r) => !r.delivered);
  const totals = {};
  for (const arm of [...new Set(rows.flatMap((r) => Object.keys(r.arms)))]) {
    // An arm a record cannot carry (no `testSelection` in it) is left out of
    // that arm's denominator, never counted as a miss.
    const had = delivered.filter((r) => r.arms[arm] !== undefined);
    const on = had.map((r) => r.arms[arm]);
    totals[arm] = {
      covers: on.filter((a) => a.covers).length,
      of: had.length,
      truthNamed: on.reduce((n, a) => n + a.truthNamed, 0),
      truthTotal: had.reduce((n, r) => n + r.truth.length, 0),
      lostCorrect: on.reduce((n, a) => n + a.lost.length, 0),
      extraPerBlock: on.length === 0 ? 0 : on.reduce((n, a) => n + a.extra, 0) / on.length,
      coversOnSilent: silent.filter((r) => r.arms[arm]?.covers === true).length,
      silent: silent.length,
    };
  }
  return totals;
}

export function formatReport(r) {
  const lines = [
    `scenarios ${r.scenarios}, blocks delivered ${r.delivered}, silent ${r.silent.length} (${r.silent.join(" ")})`,
    `frozen surface ${r.surfaceMatches ? "matches the registration" : "DIFFERS from the registration — not comparable"}`,
    `median block tokens: graph ${r.tokens_median.graph}, with both lines ${r.tokens_median.graph_name_history}`,
    "",
    "| arm | blocks naming a truth file | truth files named | correct files lost | added non-truth files per block | would name truth where the graph is silent |",
    "|---|---|---|---|---|---|",
  ];
  const table = (totals) => {
    for (const [arm, t] of Object.entries(totals)) {
      lines.push(
        `| ${arm} | ${t.covers}/${t.of} | ${t.truthNamed}/${t.truthTotal} | ${t.lostCorrect} | ${t.extraPerBlock.toFixed(2)} | ${t.coversOnSilent}/${t.silent} |`,
      );
    }
  };
  table(r.totals);
  for (const [name, part] of Object.entries(r.split ?? {})) {
    lines.push("", `${name}: ${part.scenarios.length} scenarios (${part.scenarios.join(" ")})`, lines[4], lines[5]);
    table(part.totals);
  }
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
