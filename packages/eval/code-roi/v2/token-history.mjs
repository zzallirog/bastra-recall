/**
 * Directed token coupling from git history — the "heatmap" reading of #628.
 *
 * Path co-change (`edge-sources.mjs`, HISTORY) says two files were committed
 * together. This says more and less: a RARE token is born in one file — the
 * first commit that ever adds it anywhere adds it there — and later commits add
 * the same token to other files. That is a directed edge from the birth file to
 * each adopter, and it holds whether or not the two ever shared a commit. It is
 * the contract the graph cannot see when it lives in a name: a route string, a
 * setting key, a telemetry field, a function name a test asserts on.
 *
 * FOR ONE SCENARIO the lines are the files that adopted a token the diff touches
 * and that was born in the changed file — the files that "know the linking
 * token" and would have to follow the change. Only the history up to the
 * scenario's PARENT counts: a birth or an adoption after it is not known yet.
 *
 * PARAMETERS, FIXED BEFORE THE FIRST RUN: a token is an identifier-like word of
 * at least MIN_TOKEN characters (the name guard of #628), rare means present in
 * at most MAX_DOC_FREQ code files of the parent tree, at most MAX_TOKEN_FILES
 * lines per block, ranked by how many touched tokens a file adopted.
 */
import { execFileSync } from "node:child_process";

export const MIN_TOKEN = 8;
export const MAX_DOC_FREQ = 5;
export const MAX_TOKEN_FILES = 5;
const TOKEN = /[A-Za-z_$][\w$]{7,}/g;

/**
 * Walk `git log -p` oldest first and record, for every token, the commit index
 * and file where it was first added, and every later (index, file) that added it.
 */
export function tokenEvents(repo, rev) {
  const log = execFileSync(
    "git",
    ["log", rev, "--no-merges", "--reverse", "--unified=0", "--no-renames", "--format=@@%H", "-p"],
    { cwd: repo, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  return eventsOfLog(log);
}

/** The parse, separated from git so a test can feed it a log. */
export function eventsOfLog(log) {
  const birth = new Map(); // token -> { i, file }
  const adopters = new Map(); // token -> Map(file -> first i)
  const index = new Map(); // commit sha -> position in the oldest-first log
  let i = -1;
  let file = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("@@") && !line.startsWith("@@ ")) {
      i++;
      index.set(line.slice(2).trim(), i);
      file = null;
    } else if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
    } else if (file !== null && line.startsWith("+") && !line.startsWith("+++")) {
      for (const t of new Set(line.slice(1).match(TOKEN) ?? [])) {
        if (!birth.has(t)) {
          birth.set(t, { i, file });
          continue;
        }
        if (birth.get(t).file === file) continue;
        let seen = adopters.get(t);
        if (seen === undefined) adopters.set(t, (seen = new Map()));
        if (!seen.has(file)) seen.set(file, i);
      }
    }
  }
  return { birth, adopters, index, commits: i + 1 };
}

/** Identifier-like tokens on the diff's changed lines, both sides. */
export function diffTokens(diff) {
  const out = new Set();
  for (const line of String(diff ?? "").split("\n")) {
    if ((line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))) {
      for (const t of line.slice(1).match(TOKEN) ?? []) out.add(t);
    }
  }
  return out;
}

/**
 * Token lines for one scenario. `upTo` is the index of the scenario's parent in
 * the oldest-first log: births and adoptions after it are not visible. `docFreq`
 * counts code files of the parent tree per token; `skip` holds files already named.
 */
export function tokenLines({ events, upTo, changedFile, diff, docFreq, skip, cap = MAX_TOKEN_FILES }) {
  const byFile = new Map();
  for (const t of diffTokens(diff)) {
    const b = events.birth.get(t);
    if (b === undefined || b.i > upTo || b.file !== changedFile) continue;
    if ((docFreq.get(t) ?? 0) > MAX_DOC_FREQ) continue;
    for (const [file, i] of events.adopters.get(t) ?? []) {
      if (i > upTo || file === changedFile || skip.has(file)) continue;
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(t);
    }
  }
  const hits = [...byFile].map(([file, tokens]) => ({ file, tokens }));
  hits.sort((a, b) => b.tokens.length - a.tokens.length || a.file.localeCompare(b.file));
  return cap === Infinity ? hits : hits.slice(0, cap);
}

/** Code files per token over a tree's files (Map path -> text), for the rarity guard. */
export function documentFrequency(files) {
  const df = new Map();
  for (const body of files.values()) {
    for (const t of new Set(body.match(TOKEN) ?? [])) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}
