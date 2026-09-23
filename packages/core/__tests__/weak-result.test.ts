/**
 * Pins the every/some polarity of `isWeakResult` and the one-armed `isNoHome`
 * gate. Neither had a core test: daemon tests cover the wire shape, not the
 * predicate. Mutating `some` → `every` stays green in the rest of the core
 * suite — this file is the bite.
 *
 * Revert-check: change `hits.some(...)` to `hits.every(...)` in isWeakResult
 * → "one anchored hit in a mixed list is not weak" goes red.
 *
 * Runner: node --import tsx --test packages/core/__tests__/weak-result.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWeakResult, isNoHome, hitTitleMatches } from "../src/weak-result.js";
import type { RecallHit } from "../src/search.js";

function hit(partial: Partial<RecallHit> & Pick<RecallHit, "id" | "title">): RecallHit {
  return {
    type: "lesson",
    scope: "t",
    summary: "",
    topic_path: [],
    score: 160,
    matched_terms: [],
    ...partial,
  };
}

test("isWeakResult: a mixed list is not weak — some (not every) hit must fail to anchor", () => {
  const hits = [
    hit({ id: "anchored", title: "unrelated", matched_recall_when: true }),
    hit({ id: "noise", title: "zzzz", matched_recall_when: false, matched_terms: [] }),
  ];
  assert.equal(isWeakResult(hits, true), false, "one recall_when match keeps the list from being weak");
  assert.equal(isWeakResult(hits, false), false, "BM25-only never sets weak_result");
});

test("isWeakResult: fires only when hybrid is on and nothing anchors", () => {
  const hits = [hit({ id: "noise", title: "zzzz", matched_terms: ["nope"] })];
  assert.equal(isWeakResult(hits, true), true);
  assert.equal(isWeakResult(hits, false), false);
  assert.equal(isWeakResult([], true), false, "empty is not weak — there is no rank-1-of-nothing");
});

test("hitTitleMatches is prefix-tolerant in either direction", () => {
  const h = hit({ id: "t", title: "Hosting Controller notes", matched_terms: ["host"] });
  assert.equal(hitTitleMatches(h), true);
  assert.equal(hitTitleMatches(hit({ id: "t", title: "zzz", matched_terms: ["host"] })), false);
});

test("isNoHome: one-armed top hit, only after weak_result", () => {
  const oneArm = [
    hit({
      id: "solo",
      title: "zzzz",
      rrf: { rank_bm25: 1, rank_vector: null, raw: 0.166 },
    }),
  ];
  assert.equal(isNoHome(oneArm, true), true);
  const both = [
    hit({
      id: "pair",
      title: "zzzz",
      rrf: { rank_bm25: 1, rank_vector: 4, raw: 0.3 },
    }),
  ];
  assert.equal(isNoHome(both, true), false, "both arms agreed — the fact has a home, just the wrong one");
  const anchored = [
    hit({
      id: "solo",
      title: "zzzz",
      matched_recall_when: true,
      rrf: { rank_bm25: 1, rank_vector: null, raw: 0.166 },
    }),
  ];
  assert.equal(isNoHome(anchored, true), false, "an anchored one-arm hit is not no_home");
});
