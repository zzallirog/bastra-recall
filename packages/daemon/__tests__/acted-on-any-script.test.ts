/**
 * acted_on and reflex in any script.
 *
 * acted_on: the memory side cut words with `\p{L}` (save-similarity
 * `tokens`), the tool-input side with an ASCII `[a-z0-9]` scan
 * (telemetry.ts). A Cyrillic, Greek or CJK memory therefore had no partner
 * token and could never count as acted on — and bridges, demotion and the
 * hint-follow shadow all learn from that signal. Both sides now use the same
 * tokenizer, and an inflected form counts.
 *
 * reflex: every content token of a trigger had to appear in the prompt in
 * exactly the same form, so a case ending ("арке" for "арка") missed the
 * trigger. The core word-form rule now decides.
 *
 * Revert check: restore `/[a-z0-9][a-z0-9_-]*\/g` in telemetry.ts tokenize →
 * the RU/JA acted_on tests are red; restore `contextTokens.has(t)` in
 * reflex.ts → the inflected-trigger test is red.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/acted-on-any-script.test.ts
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenizeWithIdentifiers } from "@bastra-recall/core";
import { Telemetry } from "../src/telemetry.js";
import { distinctiveTokensForActedOn } from "../src/tool-handlers.js";
import { phraseMatchesContext } from "../src/reflex.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bastra-acted-any-script-"));
  process.env.BASTRA_LOG_PATH = dir;
  process.env.BASTRA_TELEMETRY = "on";
});
afterEach(async () => {
  delete process.env.BASTRA_LOG_PATH;
  delete process.env.BASTRA_TELEMETRY;
  await rm(dir, { recursive: true, force: true });
});

function actedOn(memoryText: string, toolInput: string) {
  const t = new Telemetry();
  t.rotateTurn("s");
  const toks = distinctiveTokensForActedOn(memoryText);
  t.recordLoadedMemory({
    memory_id: "m",
    distinctive_tokens: toks,
    hook_hint: { recall_id: "r", score: 120 },
    session_id: "s",
  });
  const eps = t.matchLoadedMemories({ tool_name: "Edit", tool_input_excerpt: toolInput, session_id: "s" });
  return { toks, ep: eps[0] };
}

test("acted_on control EN: a memory applied in an English edit", () => {
  const { ep } = actedOn(
    "Backup rotation keeps seven snapshots on storagebox",
    "set rotation to seven snapshots for storagebox backup",
  );
  assert.equal(ep?.acted_on, true);
});

test("acted_on RU: the same memory in Russian, applied in a Russian edit", () => {
  const { toks, ep } = actedOn(
    "Ротация бэкапов хранит семь снапшотов на сторадж-боксе",
    "ротация бэкапов: семь снапшотов на сторадж-боксе",
  );
  assert.ok(toks.length >= 3, `memory side has Cyrillic tokens: ${toks.join(",")}`);
  assert.equal(ep?.acted_on, true, `match_strength=${ep?.match_strength}`);
});

test("acted_on RU: an inflected form in the edit still counts", () => {
  const { ep } = actedOn(
    "Ротация бэкапов хранит семь снапшотов на сторадж-боксе",
    "поменял ротацию бэкапа, снапшоты теперь по семь",
  );
  assert.equal(ep?.acted_on, true, `match_strength=${ep?.match_strength}`);
});

test("acted_on JA: a Japanese memory applied in a Japanese edit", () => {
  const { toks, ep } = actedOn(
    "バックアップのローテーションは七つのスナップショットを保持する",
    "ローテーションを変更：スナップショットは七つ、バックアップは毎晩",
  );
  assert.ok(toks.length >= 3, `memory side has Japanese words: ${toks.join(",")}`);
  assert.equal(ep?.acted_on, true, `match_strength=${ep?.match_strength}`);
});

test("acted_on stays strict: an unrelated Russian edit is not acted on", () => {
  const { ep } = actedOn(
    "Ротация бэкапов хранит семь снапшотов на сторадж-боксе",
    "обновил README про установку демона",
  );
  assert.equal(ep?.acted_on, false);
});

function ctx(prompt: string): [Set<string>, string] {
  const toks = tokenizeWithIdentifiers(prompt.toLowerCase());
  return [new Set(toks), ` ${toks.join(" ")} `];
}

test("reflex: a case ending in the prompt satisfies the trigger", () => {
  const [tokens, seq] = ctx("глянь что в арке по ревью");
  assert.equal(phraseMatchesContext("ревью арка", tokens, seq), true);
});

test("reflex: a Japanese trigger fires on a Japanese prompt", () => {
  const [tokens, seq] = ctx("ゲームモードの設定を変更して");
  assert.equal(phraseMatchesContext("ゲームモード 設定", tokens, seq), true);
});

// Revert-check: drop the Hiragana rule in lexical.ts isSignificantLength →
// "する"/"とき" stay required and this test is red.
test("reflex: Japanese grammar in the trigger is not demanded from the prompt", () => {
  const [tokens, seq] = ctx("このブランチを公開リポジトリにプッシュして");
  assert.equal(phraseMatchesContext("公開リポジトリにプッシュするとき", tokens, seq), true);
  const [t2, s2] = ctx("ゲームモードを切り替えたらどうなる？");
  assert.equal(phraseMatchesContext("ゲームモードを切り替えるとき", t2, s2), true);
  const [t3, s3] = ctx("ブランチを削除して");
  assert.equal(phraseMatchesContext("公開リポジトリにプッシュするとき", t3, s3), false, "content words still decide");
});

test("reflex stays strict: a missing content word still blocks the trigger", () => {
  const [tokens, seq] = ctx("глянь что в арке");
  assert.equal(phraseMatchesContext("ревью арка", tokens, seq), false);
});
