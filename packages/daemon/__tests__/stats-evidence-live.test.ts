/**
 * M5-02 — once the evidence gate is ACTIVE (live decisions exist), the
 * decision table / abstain reasons / required-by-hop printout must count
 * live decisions too, not shadow rows only. `summarizeEvidenceGate` built
 * its table from `shadow.flatMap(decisionsOf)` even when `live` carried the
 * only decisions in the window, so an active gate printed "the gate is
 * ACTIVE" immediately followed by required 0 / optional 0 / no_answer 0 —
 * the canonical `src/telemetry-report.ts` counts `usable` (shadow + live)
 * for the same table.
 * Revert-check: on unfixed stats-evidence.ts this test fails because the
 * printed "required" count is 0 although a live decision was required.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEvidenceGate } from "../scripts/stats-evidence.js";
import type { EvidenceDeps } from "../scripts/stats-evidence.js";

function pct(n: number, total: number): string {
  return total === 0 ? "n/a" : `${((n / total) * 100).toFixed(1)}%`;
}

const deps: EvidenceDeps = { pct, MUST_LOAD_SCORE: 30, SCORE_FLOOR: 0 };

test("M5-02: live decisions are counted in the decision table, not shadow-only", () => {
  const events = [
    {
      kind: "evidence_decision",
      ts: "2026-09-28T00:00:00Z",
      shadow: false,
      recall_id: "r1",
      decisions: [{ memory_id: "m1", decision: "required", hop: "direct" }],
    },
  ];
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    summarizeEvidenceGate(events, deps);
  } finally {
    console.log = orig;
  }
  const decisionLine = lines.find((l) => l.trim().startsWith("required"));
  assert.ok(decisionLine, "expected a printed 'required' row");
  assert.match(decisionLine!, /required\s+1\b/, "a live required decision must show up as 1, not 0");
});
