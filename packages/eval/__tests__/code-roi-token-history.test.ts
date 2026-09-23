/**
 * Directed token coupling from history (#628, the heatmap reading).
 *
 * The rules each case pins: a token belongs to the file it was BORN in; only
 * files that adopted it later are named; nothing after the scenario's own commit
 * is visible; a token common across the tree is not a contract.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error — plain .mjs script, no declarations (#542).
const t = await import("../code-roi/v2/token-history.mjs");

// Oldest first: c0 births `routeSessionContext` in lane.ts and `sharedHelperName` in util.ts,
// c1 adopts the route into a test, c2 adopts it into docs-lane.ts (after the scenario).
const log = [
  "@@c0",
  "+++ b/src/lane.ts",
  "@@ -0,0 +1,1 @@",
  '+export const routeSessionContext = "/hook/session-context";',
  "+++ b/src/util.ts",
  "@@ -0,0 +1,1 @@",
  "+export function sharedHelperName() {}",
  "@@c1",
  "+++ b/__tests__/session.test.ts",
  "@@ -0,0 +1,2 @@",
  "+import { routeSessionContext } from '../src/lane.js';",
  "+sharedHelperName();",
  "@@c2",
  "+++ b/src/docs-lane.ts",
  "@@ -0,0 +1,1 @@",
  "+use(routeSessionContext);",
  "",
].join("\n");
const events = t.eventsOfLog(log);
const diff = ["--- a/src/lane.ts", "+++ b/src/lane.ts", '-export const routeSessionContext = "/hook/session-context";', "+export const routeSessionContext = \"/hook/ctx\";", "+sharedHelperName();"].join("\n");
const rare = new Map([["routeSessionContext", 3], ["sharedHelperName", 2]]);

describe("token history", () => {
  test("a token is born where it is first added, and later adders are its adopters", () => {
    assert.deepEqual(events.birth.get("routeSessionContext"), { i: 0, file: "src/lane.ts" });
    assert.deepEqual([...events.adopters.get("routeSessionContext")], [["__tests__/session.test.ts", 1], ["src/docs-lane.ts", 2]]);
    assert.equal(events.index.get("c1"), 1);
  });

  test("names the adopters of tokens born in the changed file, and nothing after the scenario", () => {
    const lines = t.tokenLines({ events, upTo: 1, changedFile: "src/lane.ts", diff, docFreq: rare, skip: new Set() });
    assert.deepEqual(lines, [{ file: "__tests__/session.test.ts", tokens: ["routeSessionContext"] }]);
  });

  test("a token born in another file is not the changed file's contract", () => {
    const lines = t.tokenLines({ events, upTo: 2, changedFile: "src/lane.ts", diff, docFreq: rare, skip: new Set() });
    assert.ok(lines.every((h: { tokens: string[] }) => !h.tokens.includes("sharedHelperName")));
  });

  test("a token in too many files is not a contract", () => {
    const common = new Map([["routeSessionContext", t.MAX_DOC_FREQ + 1]]);
    assert.deepEqual(t.tokenLines({ events, upTo: 2, changedFile: "src/lane.ts", diff, docFreq: common, skip: new Set() }), []);
  });
});
