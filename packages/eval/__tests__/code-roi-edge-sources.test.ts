/**
 * The two sources #628 proposes, as the offline measurement computes them.
 *
 * Each case pins one rule of the proposal, so a change that quietly widens a
 * source — history reaching into code, a name line repeating a graph line, a
 * short name standing for a caller — turns a case red instead of turning into a
 * better number:
 *
 *   - a name counts only when it is long enough and defined once in the graph;
 *   - a name line never repeats the changed file or a file the block listed;
 *   - history never sees a commit of more than 30 files, and the proposal's
 *     history only names partners outside the code-only graph;
 *   - adding lines can never lose a correct file the graph block had.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error — plain .mjs script, no declarations (#542).
const m = await import("../code-roi/v2/edge-sources.mjs");

const graph = {
  nodes: [
    { label: "assembleSession()", source_file: "packages/daemon/src/session-assembler.ts" },
    { label: "render()", source_file: "packages/daemon/src/a.ts" },
    { label: "render()", source_file: "packages/daemon/src/b.ts" },
    { label: "duplicatedName()", source_file: "packages/daemon/src/a.ts" },
    { label: "duplicatedName()", source_file: "packages/daemon/src/b.ts" },
    { label: "ref_core", source_file: "" },
  ],
};

describe("distinctive names", () => {
  test("keeps a long name defined once, drops short and twice-defined names", () => {
    assert.deepEqual(m.distinctiveNames(["assembleSession", "render", "duplicatedName"], graph), ["assembleSession"]);
  });

  test("an external node with an empty source file is not a definition", () => {
    const g = { nodes: [...graph.nodes, { label: "assembleSession", source_file: "" }] };
    assert.deepEqual(m.distinctiveNames(["assembleSession"], g), ["assembleSession"]);
  });
});

describe("name lines", () => {
  const files = new Map([
    ["packages/daemon/src/session-assembler.ts", "export function assembleSession() {}"],
    ["packages/daemon/__tests__/session-assembler.test.ts", 'import { assembleSession } from "../src/x.js";'],
    ["packages/daemon/src/lane.ts", "const s = assembleSession (opts);"],
    ["packages/daemon/src/comment.ts", "// assembleSession is documented elsewhere"],
    ["packages/daemon/src/listed.ts", "assembleSession();"],
  ]);

  test("a call or an import counts, a mention in a comment does not", () => {
    const lines = m.nameLines({
      names: ["assembleSession"],
      files,
      changedFile: "packages/daemon/src/session-assembler.ts",
      listed: [],
    });
    assert.deepEqual(
      lines.map((h: { file: string }) => h.file),
      [
        "packages/daemon/__tests__/session-assembler.test.ts",
        "packages/daemon/src/lane.ts",
        "packages/daemon/src/listed.ts",
      ],
    );
  });

  test("never repeats the changed file or a file the graph block already listed", () => {
    const lines = m.nameLines({
      names: ["assembleSession"],
      files,
      changedFile: "packages/daemon/src/session-assembler.ts",
      listed: ["packages/daemon/src/listed.ts"],
    });
    const named = lines.map((h: { file: string }) => h.file);
    assert.ok(!named.includes("packages/daemon/src/listed.ts"));
    assert.ok(!named.includes("packages/daemon/src/session-assembler.ts"));
  });

  test("is capped", () => {
    const many = new Map(Array.from({ length: 9 }, (_, i) => [`f${i}.ts`, "assembleSession();"]));
    assert.equal(m.nameLines({ names: ["assembleSession"], files: many, changedFile: "x.ts", listed: [] }).length, m.MAX_NAME_FILES);
  });
});

describe("co-change history", () => {
  const commits = [
    ["src/a.ts", "docs/a.md"],
    ["src/a.ts", "docs/a.md", "src/b.ts"],
    ["src/a.ts", "src/b.ts"],
    ["src/a.ts"],
    Array.from({ length: 31 }, (_, i) => (i === 0 ? "src/a.ts" : `bulk/${i}.md`)),
  ];
  const counts = m.coChangeCounts(commits);

  test("single-file commits and commits over 30 files are not counted", () => {
    assert.equal(counts.changes.get("src/a.ts"), 3);
    assert.equal(counts.pairs.get("src/a.ts").get("bulk/1.md"), undefined);
  });

  test("the proposal's history names only partners outside the code graph", () => {
    const inGraph = new Set(["src/a.ts", "src/b.ts"]);
    const lines = m.historyLines({ counts, file: "src/a.ts", keep: (p: string) => !inGraph.has(p), skip: new Set() });
    assert.deepEqual(
      lines.map((h: { file: string; support: number; changes: number }) => [h.file, h.support, h.changes]),
      [["docs/a.md", 2, 3]],
    );
  });

  test("support below the threshold is not a line", () => {
    const thin = m.coChangeCounts([["src/a.ts", "docs/once.md"], ["src/a.ts", "src/c.ts"]]);
    assert.deepEqual(m.historyLines({ counts: thin, file: "src/a.ts", keep: () => true, skip: new Set() }), []);
  });
});

describe("scoring", () => {
  test("adding lines never loses a correct file, and a dropped one is reported", () => {
    const truth = ["t/a.test.ts", "t/b.test.ts"];
    const graphListed = ["src/x.ts", "t/a.test.ts"];
    assert.deepEqual(m.scoreArm([...graphListed, "t/b.test.ts", "src/y.ts"], truth, graphListed), {
      covers: true,
      truthNamed: 2,
      lost: [],
      extra: 1,
    });
    assert.deepEqual(m.scoreArm(["src/x.ts"], truth, graphListed).lost, ["t/a.test.ts"]);
  });

  test("the rendered block keeps the product's lines and adds labelled ones before the close", () => {
    const note = '<code-impact file="a.ts" basis="symbols" files="1">\nMay break (1 candidate file):\n- b.ts — calls x\n</code-impact>';
    const out = m.renderWithSources(note, [{ file: "c.test.ts", names: ["assembleSession"] }], [
      { file: "docs/a.md", support: 2, changes: 3 },
    ]);
    assert.ok(out.startsWith(note.replace(/\n<\/code-impact>$/, "")));
    assert.match(out, /By name \(name match, unverified\):\n- c\.test\.ts — uses assembleSession/);
    assert.match(out, /Changed together before \(history, paths only\):\n- docs\/a\.md — 2 of 3 changes\n<\/code-impact>$/);
  });
});

describe("dangling imports", () => {
  // a1a96db3: prompt-lane.ts starts importing a module the same commit creates.
  const diff = [
    "--- a/packages/daemon/src/prompt-lane.ts",
    "+++ b/packages/daemon/src/prompt-lane.ts",
    "@@ -1,1 +1,3 @@",
    '+import { promptImpactNote } from "./code-graph/prompt-impact.js";',
    '+import { settings } from "./settings.js";',
    ' import { a } from "./a.js";',
  ].join("\n");
  const parent = new Map([
    ["packages/daemon/src/settings.ts", "export const settings = {};"],
    ["packages/daemon/src/a.ts", "export function a() {}"],
  ]);

  test("names an added import the parent tree does not have, and only that one", () => {
    assert.deepEqual(m.danglingImports(diff, "packages/daemon/src/prompt-lane.ts", parent), ["./code-graph/prompt-impact.js"]);
  });

  test("an import that resolves (.js written, .ts on disk) is not dangling", () => {
    const all = new Map([...parent, ["packages/daemon/src/code-graph/prompt-impact.ts", "export function promptImpactNote() {}"]]);
    assert.deepEqual(m.danglingImports(diff, "packages/daemon/src/prompt-lane.ts", all), []);
  });
});

describe("missing exports", () => {
  // 0d376847: documents-write-handler.ts imports `hiddenOnDisk`, which the same commit adds to private-access.ts.
  const diff = ["@@ -1,1 +1,1 @@", '+import { hiddenFromCaller, hiddenOnDisk } from "./private-access.js";', '+import type { Later } from "./private-access.js";'].join("\n");
  const parent = new Map([["packages/daemon/src/private-access.ts", "export function hiddenFromCaller() {}"]]);

  test("an imported name the parent's module does not export is a half-applied commit too", () => {
    assert.deepEqual(m.danglingImports(diff, "packages/daemon/src/documents-write-handler.ts", parent), ["hiddenOnDisk from ./private-access.js"]);
  });

  test("a type-only import never fails at load, so it is not flagged", () => {
    const only = ["@@ -1,1 +1,1 @@", '+import type { Later } from "./private-access.js";'].join("\n");
    assert.deepEqual(m.danglingImports(only, "packages/daemon/src/documents-write-handler.ts", parent), []);
  });
});

describe("multi-line imports", () => {
  // 7c5946c9: bash-fail-lane.ts adds `mutateSessionState` inside an existing multi-line import.
  const diff = ["@@ -1,4 +1,5 @@", " import {", "   loadSessionState,", "+  mutateSessionState,", ' } from "./session-state.js";'].join("\n");
  const parent = new Map([["packages/daemon/src/session-state.ts", "export function loadSessionState() {}"]]);

  test("a name added inside a multi-line import is checked against the parent module", () => {
    assert.deepEqual(m.danglingImports(diff, "packages/daemon/src/bash-fail-lane.ts", parent), ["mutateSessionState from ./session-state.js"]);
  });

  test("an untouched multi-line import is not flagged", () => {
    const same = ["@@ -1,4 +1,4 @@", " import {", "   loadSessionState,", ' } from "./session-state.js";', "+const x = 1;"].join("\n");
    assert.deepEqual(m.danglingImports(same, "packages/daemon/src/bash-fail-lane.ts", parent), []);
  });
});
