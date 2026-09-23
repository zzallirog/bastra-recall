/**
 * Co-change at FUNCTION grain (#628, owner's "granularity + deep check", 09-23).
 *
 * File-level co-change drowns in the big files: `http.ts` or `session-lane.ts`
 * are committed with almost everything, so "changed together with this file"
 * names noise. Git can follow one function instead — `git log -L :name:file`
 * lists exactly the commits that touched that function's lines — and the files
 * those commits also changed are the function's own history partners.
 *
 * The changed functions come from the product (`changedSymbolsOf` over the
 * parent's graph, the prefill arm's call), so the chain is the one the owner
 * described: a file changes → which functions → their history in git → which
 * files moved with them. Only commits up to the scenario's PARENT count.
 *
 * PARAMETERS, FIXED BEFORE THE FIRST RUN: a partner needs at least
 * MIN_SUPPORT commits shared with the changed functions; at most MAX_FN_FILES
 * lines, ranked by that count, then by path.
 */
import { execFileSync } from "node:child_process";

export const MIN_SUPPORT = 2;
export const MAX_FN_FILES = 5;

const git = (repo, args) => {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return ""; // `-L` refuses a name its funcname pattern cannot find: no history, not an error
  }
};

/** Commits up to `rev` that touched the function `name` in `file`. */
export function functionCommits(repo, rev, file, name) {
  const bare = String(name).replace(/\(\)$/, "").split(".").pop();
  if (!/^[A-Za-z_$][\w$]*$/.test(bare)) return [];
  return git(repo, ["log", "-L", `:${bare}:${file}`, "--no-patch", "--format=%H", rev]).split("\n").filter(Boolean);
}

/** Files each commit changed, cached across scenarios. */
const filesOfCommit = new Map();
function changedFiles(repo, sha) {
  if (!filesOfCommit.has(sha)) {
    filesOfCommit.set(sha, git(repo, ["show", "--no-renames", "--name-only", "--format=", sha]).split("\n").filter(Boolean));
  }
  return filesOfCommit.get(sha);
}

/** Pure part: rank partners from the per-function commit lists. */
export function partnersOf(commitFiles, changedFile, skip, { minSupport = MIN_SUPPORT, cap = MAX_FN_FILES } = {}) {
  const support = new Map();
  for (const files of commitFiles.values()) {
    for (const f of new Set(files)) {
      if (f === changedFile || skip.has(f)) continue;
      support.set(f, (support.get(f) ?? 0) + 1);
    }
  }
  return [...support]
    .filter(([, n]) => n >= minSupport)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([file, n]) => ({ file, support: n }));
}

/** Function-history lines for one scenario. */
export function functionHistoryLines({ repo, parent, file, functions, skip }) {
  const commitFiles = new Map(); // sha -> files, each commit once however many functions it touched
  for (const fn of new Set(functions)) {
    for (const sha of functionCommits(repo, parent, file, fn)) {
      if (!commitFiles.has(sha)) commitFiles.set(sha, changedFiles(repo, sha));
    }
  }
  return { lines: partnersOf(commitFiles, file, skip), commits: commitFiles.size };
}
