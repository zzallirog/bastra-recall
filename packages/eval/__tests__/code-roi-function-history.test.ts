/**
 * Co-change at function grain (#628): `git log -L` follows one function, not
 * the whole file, and its commits' other files are the partners.
 *
 * Pinned: a commit that touched another function of the same file is NOT a
 * partner source; partners below the support threshold are not named; the
 * changed file and already-listed files never come back as lines.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error — plain .mjs script, no declarations (#542).
const f = await import("../code-roi/v2/function-history.mjs");

describe("function-level partners", () => {
  test("ranks by shared commits and drops partners below the threshold", () => {
    const commits = new Map([
      ["c1", ["src/a.ts", "docs/a.md", "src/b.ts"]],
      ["c2", ["src/a.ts", "docs/a.md"]],
      ["c3", ["src/a.ts", "src/c.ts"]],
    ]);
    assert.deepEqual(f.partnersOf(commits, "src/a.ts", new Set(["src/b.ts"])), [{ file: "docs/a.md", support: 2 }]);
  });
});

describe("git log -L", () => {
  test("names only the commits that touched THIS function, not every commit of its file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fn-history-"));
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
    try {
      g("init", "-q");
      g("config", "user.email", "t@t");
      g("config", "user.name", "t");
      const body = (one: string, two: string) =>
        `export function alphaFunction() {\n  return ${one};\n}\n\nexport function betaFunction() {\n  return ${two};\n}\n`;
      writeFileSync(join(dir, "m.ts"), body("1", "1"));
      g("add", ".");
      g("commit", "-qm", "init");
      writeFileSync(join(dir, "m.ts"), body("2", "1"));
      writeFileSync(join(dir, "alpha.md"), "a");
      g("add", ".");
      g("commit", "-qm", "alpha");
      writeFileSync(join(dir, "m.ts"), body("2", "2"));
      writeFileSync(join(dir, "beta.md"), "b");
      g("add", ".");
      g("commit", "-qm", "beta");
      const alpha = f.functionCommits(dir, "HEAD", "m.ts", "alphaFunction").map((sha: string) => g("log", "-1", "--format=%s", sha).trim());
      assert.deepEqual(alpha.sort(), ["alpha", "init"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
