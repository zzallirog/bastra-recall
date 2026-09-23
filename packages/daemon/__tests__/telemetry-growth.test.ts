/**
 * In-memory telemetry maps had a TTL on restore, none on the write path.
 *
 * Revert-check: delete the MAX_TURN_TRACES FIFO in rotateTurn → 10k unique
 * sessions flush 10000 turns into join-state.json. Delete MAX_HOOK_HINTS
 * FIFO in recordHookHints → hookHints length is 10000.
 *
 * Runner: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/telemetry-growth.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_HOOK_HINTS, MAX_TURN_TRACES, Telemetry } from "../src/telemetry.js";

test("rotateTurn: 10k unique sessions stay at MAX_TURN_TRACES", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tel-turns-"));
  try {
    const tel = new Telemetry({ logDir: dir });
    for (let i = 0; i < 10_000; i++) tel.rotateTurn(`session-${i}`);
    await tel.flushNow();
    const snap = JSON.parse(await readFile(join(dir, "join-state.json"), "utf8")) as {
      turns: unknown[];
    };
    assert.ok(snap.turns.length <= MAX_TURN_TRACES, `turns grew to ${snap.turns.length}`);
    assert.equal(snap.turns.length, MAX_TURN_TRACES);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordHookHints: 10k unique ids stay at MAX_HOOK_HINTS", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tel-hints-"));
  try {
    const tel = new Telemetry({ logDir: dir });
    for (let i = 0; i < 10_000; i++) tel.recordHookHints(`r-${i}`, [{ id: `m-${i}`, score: 50 }]);
    await tel.flushNow();
    const snap = JSON.parse(await readFile(join(dir, "join-state.json"), "utf8")) as {
      hookHints: unknown[];
    };
    assert.ok(snap.hookHints.length <= MAX_HOOK_HINTS, `hookHints grew to ${snap.hookHints.length}`);
    assert.equal(snap.hookHints.length, MAX_HOOK_HINTS);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
