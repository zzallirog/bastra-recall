/**
 * A transcript row Claude Code marks `isMeta: true` is not the user.
 *
 * Hook feedback ("Stop hook feedback: …") is written as a role "user" row with
 * isMeta set. normalizeTurns read only the text prefix, so the session harvest
 * (#675) quoted repeated hook feedback as "the user said this verbatim" — on
 * one user's 225 transcripts, 13 of 14 harvest candidates were hook rows — and
 * the frustration/decision heuristics read it as the user's prose.
 *
 * Revert-check: drop the `obj.isMeta === true` branch in normalizeTurns → the
 * harvest and the frustration tests are red.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/stop-lane-ismeta.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTurns, evaluateHeuristics } from "../src/stop-lane.js";
import { harvestCandidates } from "../src/session-harvest.js";

const user = (content: string, extra: Record<string, unknown> = {}) => ({ type: "user", message: { role: "user", content: content as unknown }, ...extra });
const asst = (text: string) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const hookFeedback = (body: string) => user(`Stop hook feedback:\n${body}`, { isMeta: true });

test("hook feedback rows are never harvested as something the user said", () => {
  const gate = "[gate] the closing message claims the work is done but no test run is visible in this turn, run the suite first";
  const turns = normalizeTurns([
    user("please add the retry to the uploader"),
    asst("Done."),
    hookFeedback(gate),
    asst("Running the suite."),
    asst("Done."),
    hookFeedback(gate),
    asst("Ran it."),
  ]);
  assert.deepEqual(harvestCandidates(turns), []);
});

test("hook feedback does not feed the frustration heuristic", () => {
  const nag = "again: the turn ended without a step — again, again, how many times, damn";
  const rows = [user("fix the build")];
  for (let i = 0; i < 4; i++) rows.push(asst("ok"), hookFeedback(nag));
  const s = evaluateHeuristics(normalizeTurns(rows));
  assert.equal(s.find((x) => x.heuristic === "frustration-density"), undefined);
});

test("a typed answer to the agent's question is still harvested (control)", () => {
  const turns = normalizeTurns([
    user("set up the backup"),
    asst("Which retention do you want — seven or fourteen snapshots?"),
    user("seven, and keep them on the storage box, never on the laptop"),
    asst("Done."),
  ]);
  assert.ok(harvestCandidates(turns).some((c) => c.kind === "answer"));
});
