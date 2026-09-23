// Merge the truth caches of the two mining hosts and decide exactly as mine-repo.mjs `decide()` does.
// usage: HOME=<fakehome> node merge-decide.mjs <eval checkout> <repo at c0667f1d> <out.jsonl> <cache.jsonl>...
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [evalDir, repo, outPath, ...caches] = process.argv.slice(2);
const v2 = join(evalDir, "packages", "eval", "code-roi", "v2");
const { repoProfile, isScenarioFile } = await import(join(v2, "repo-profile.mjs"));
const { buildExclusions, isExcludedFile } = await import(join(v2, "exclusions.mjs"));
const { truthPopulationHash } = await import(join(v2, "test-truth.mjs"));
const MAX_TRUTH = 40; // mine-repo.mjs

const profile = repoProfile(repo);
const ex = buildExclusions();
const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
const commits = git(["rev-list", "--no-merges", "HEAD"]).split("\n").filter(Boolean);
const filesByCommit = new Map();
for (const c of commits) {
  if (ex.commits.includes(c)) continue;
  const files = git(["diff-tree", "--no-commit-id", "--name-status", "-r", c])
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(([s, p]) => s === "M" && isScenarioFile(profile, p ?? "") && !isExcludedFile(ex, p ?? ""))
    .map(([, p]) => p)
    .sort();
  if (files.length > 0) filesByCommit.set(c, files);
}

const cache = new Map();
for (const path of caches) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    cache.set(`${r.commit}:${r.file}`, r); // repo path differs per host; commit+file is the identity
  }
}

const decisions = [];
const usedFiles = new Set();
let blockedAt = null;
walk: for (const commit of commits) {
  for (const file of filesByCommit.get(commit) ?? []) {
    const r = cache.get(`${commit}:${file}`);
    if (r === undefined) { blockedAt = commit; break walk; }
    if (r.reason !== undefined) { decisions.push({ ...r, accepted: false }); continue; }
    if (usedFiles.has(file)) { decisions.push({ ...r, accepted: false, reason: "file already used" }); continue; }
    if (r.truth.length === 0) { decisions.push({ ...r, accepted: false, reason: "breaks nothing" }); continue; }
    if (r.truth.length > MAX_TRUTH) { decisions.push({ ...r, accepted: false, reason: "too many truth files" }); continue; }
    usedFiles.add(file);
    decisions.push({ ...r, accepted: true });
  }
}
const kept = decisions.filter((d) => d.accepted);
writeFileSync(outPath, decisions.map((d) => JSON.stringify(d)).join("\n") + "\n");
const total = [...filesByCommit.values()].reduce((n, f) => n + f.length, 0);
console.log(
  `cached ${cache.size}/${total} candidates; decided prefix ${decisions.length}` +
    (blockedAt ? ` (blocked at walk commit ${commits.indexOf(blockedAt)} ${blockedAt.slice(0, 8)})` : " (walk complete)") +
    `; accepted ${kept.length}; hash of accepted ${truthPopulationHash(kept).slice(0, 12)}`,
);
for (const [i, d] of kept.entries()) {
  console.log(`  ${String(i + 1).padStart(2)} ${d.commit.slice(0, 8)} ${d.file} -> ${d.truth.join(", ")}${d.blindSpots?.length ? " [blind]" : ""}${d.truthSource && d.truthSource !== "tests" ? ` [${d.truthSource}]` : ""}`);
}
