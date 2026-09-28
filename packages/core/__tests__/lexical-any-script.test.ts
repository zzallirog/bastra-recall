/**
 * One word rule for every script (core/src/lexical.ts).
 *
 * Each block pins a matcher that used to answer "what is a word" on its own
 * and was wrong outside English/German:
 *   - sameWordForm: Russian case endings, German/English suffixes, Japanese
 *     okurigana are one word; short tokens and identifiers stay exact.
 *   - tokenizeWithIdentifiers (BM25 index AND query): Japanese, written
 *     without spaces, reached the index as one sentence-long token, so no
 *     Japanese query could ever match a Japanese memory lexically.
 *   - hitTitleMatches: a one-letter title token ("в", "a") was a prefix of
 *     every query term starting with that letter and silenced weak_result.
 *
 * Revert check: restore `out.push(token)` for spaceless runs in
 * query-normalize.ts → the Japanese BM25 test is red; restore the raw
 * two-way `startsWith` in weak-result.ts → the one-letter test is red.
 *
 * Runner: node --import tsx --test packages/core/__tests__/lexical-any-script.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sameWordForm, segmentWords, isSignificantLength, hasWordForm } from "../src/lexical.js";
import { tokenizeWithIdentifiers } from "../src/query-normalize.js";
import { hitTitleMatches } from "../src/weak-result.js";
import { Vault } from "../src/vault.js";
import { SearchIndex } from "../src/search.js";
import type { RecallHit } from "../src/search.js";

test("sameWordForm: an ending is not a different word, in any suffixing script", () => {
  const same: [string, string][] = [
    ["арка", "арке"],
    ["арка", "арку"],
    ["снял", "снять"],
    ["забрать", "забрал"],
    ["положи", "положить"],
    ["antwort", "antworten"],
    ["update", "updated"],
    ["切り替え", "切り替える"],
    // Agglutination: a long ending on the whole stem.
    ["laskun", "laskuissa"],
    ["şablonu", "şablonlarında"],
    ["청구서", "청구서들을"], // Hangul compares jamo
    // Prefixes: Arabic/Hebrew clitics and articles, a swapped Bantu class prefix.
    ["قالب", "بالقالب"],
    ["فاتورة", "الفاتورة"],
    ["חשבונית", "החשבוניות"],
    ["kiolezo", "violezo"],
  ];
  for (const [a, b] of same) {
    assert.equal(sameWordForm(a, b), true, `${a} ~ ${b}`);
    assert.equal(sameWordForm(b, a), true, `${b} ~ ${a} (symmetric)`);
  }
});

test("sameWordForm: short tokens, identifiers and long gaps stay exact", () => {
  const different: [string, string][] = [
    ["state", "statement"], // gap 4
    ["code", "card"],
    ["cd", "ci"], // too short to say anything
    ["кот", "код"], // 3 letters: exact only
    ["v1.0", "v1.1"], // not letters only
    ["node18", "node20"],
    ["移行", "移動"], // 2 characters: exact only
    ["range", "orange"], // a prefix needs a six-letter stem outside the abjads
    ["decision", "precision"], // a swapped first letter is not room for a longer prefix
    ["contract", "contradiction"], // a long ending needs the whole shorter token as stem
    ["ספר", "ספק"], // a three-letter abjad root has no ending to spare
  ];
  for (const [a, b] of different) assert.equal(sameWordForm(a, b), false, `${a} ≁ ${b}`);
});

test("hasWordForm: exact hit first, word form as fallback", () => {
  const ctx = new Set(["повесь", "арке", "ревью"]);
  assert.equal(hasWordForm(ctx, "арке"), true);
  assert.equal(hasWordForm(ctx, "арка"), true);
  assert.equal(hasWordForm(ctx, "повесить"), true);
  assert.equal(hasWordForm(ctx, "код"), false);
});

test("segmentWords: Japanese splits into words, other runs stay whole", () => {
  const ja = segmentWords("移行してから再起動する");
  assert.ok(ja.includes("移行"), ja.join("|"));
  assert.ok(ja.includes("起動"), ja.join("|"));
  assert.ok(ja.length >= 4, "a Japanese sentence is several words, not one token");
  assert.deepEqual(segmentWords("my-app.config.ts"), ["my-app.config.ts"]);
  assert.deepEqual(segmentWords("арке"), ["арке"]);
});

test("isSignificantLength: a two-character Han/Kana word is content, a two-letter Latin word is not", () => {
  assert.equal(isSignificantLength("移行", 3), true);
  assert.equal(isSignificantLength("on", 3), false);
  assert.equal(isSignificantLength("во", 3), false);
  assert.equal(isSignificantLength("арка", 3), true);
  // Hiragana-only tokens are grammar (particles, auxiliaries, endings).
  assert.equal(isSignificantLength("とき", 3), false);
  assert.equal(isSignificantLength("する", 3), false);
  assert.equal(isSignificantLength("プッシュ", 3), true);
});

test("tokenizeWithIdentifiers: Japanese reaches the index as words; identifiers keep dual emission", () => {
  const ja = tokenizeWithIdentifiers("ゲームモードの切り替えは再起動が必要");
  assert.ok(ja.includes("ゲーム") && ja.includes("モード"), ja.join("|"));
  assert.ok(!ja.some((t) => t.length > 8), "no sentence-long token survives");
  assert.deepEqual(tokenizeWithIdentifiers("my-app.config.ts"), ["my-app.config.ts", "my", "app", "config", "ts"]);
});

function memo(id: string, title: string, recallWhen: string, body: string): string {
  const ts = new Date().toISOString();
  return [
    "---",
    `id: ${id}`,
    `title: ${title}`,
    "type: lesson",
    `summary: ${title}`,
    "topic_path:",
    "  - test",
    "tags:",
    "  - test",
    "scope: all-projects",
    "recall_when:",
    `  - ${recallWhen}`,
    `created: ${ts}`,
    `updated: ${ts}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

test("BM25: a Japanese question finds the Japanese memory that answers it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-lexical-ja-"));
  await writeFile(
    path.join(dir, "ja.md"),
    memo(
      "game-mode-ja",
      "ゲーム中にゲームモードを切り替えない",
      "ゲームモードの設定を変更するとき",
      "ゲームの実行中にサービスを再起動するとクラッシュする。",
    ),
    "utf8",
  );
  await writeFile(
    path.join(dir, "en.md"),
    memo("backup-en", "Backup rotation keeps seven snapshots", "changing backup rotation", "Seven snapshots."),
    "utf8",
  );
  const vault = new Vault(dir);
  await vault.init();
  const idx = new SearchIndex(vault);
  idx.start();
  try {
    const hits = idx.recall("ゲームモードを再起動してもいい？", { k: 3 });
    assert.equal(hits[0]?.id, "game-mode-ja", `hits: ${hits.map((h) => h.id).join(",")}`);
  } finally {
    idx.stop();
    await vault.stop?.();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("hitTitleMatches: a one-letter title word anchors nothing; a real word form still does", () => {
  const hit = (title: string, matched: string[]) =>
    ({ id: "x", title, matched_terms: matched, score: 1 }) as unknown as RecallHit;
  assert.equal(hitTitleMatches(hit("Бэкап в хранилище", ["вектор"])), false, "'в' is not a prefix anchor");
  assert.equal(hitTitleMatches(hit("A note on caching", ["address"])), false, "'a' is not a prefix anchor");
  assert.equal(hitTitleMatches(hit("Правка арки перед ревью", ["арке"])), true, "case ending still anchors");
  assert.equal(hitTitleMatches(hit("Caching strategy", ["cach"])), true, "a stemmed prefix of a word still anchors");
});
