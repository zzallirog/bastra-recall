/**
 * Audit F19 — todo topic extraction stripped every letter outside a-z0-9äöüß,
 * so a Russian/Greek/CJK todo list produced no topics and no query.
 * Revert-check: restore `/[^a-z0-9äöüß\s-]/gi` in todo-lane.ts and these
 * tests go red (topics empty); the Latin control keeps passing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTopicsFromTodos } from "../src/todo-lane.js";

test("F19: Latin control — shared word becomes a topic", () => {
  const ex = extractTopicsFromTodos([{ content: "check nginx config" }, { content: "rotate nginx logs" }]);
  assert.deepEqual(ex.topics, ["nginx"]);
});

test("F19: Cyrillic todos yield their shared word as topic", () => {
  const ex = extractTopicsFromTodos([{ content: "проверить конфиг nginx" }, { content: "обновить конфиг сервера" }]);
  assert.ok(ex.topics.includes("конфиг"), `topics: ${ex.topics.join(",")}`);
  assert.ok(ex.query.includes("конфиг"));
});

test("F19: accented Latin letters are kept whole, not split at the accent", () => {
  const ex = extractTopicsFromTodos([{ content: "réécrire le déploiement" }, { content: "tester le déploiement" }]);
  assert.ok(ex.topics.includes("déploiement"), `topics: ${ex.topics.join(",")}`);
});

test("F19: a spaceless-script todo is split into words, not one sentence-long token", () => {
  const ex = extractTopicsFromTodos([{ content: "設定ファイルを確認" }, { content: "設定を更新する" }]);
  assert.ok(ex.topics.includes("設定"), `topics: ${ex.topics.join(",")}`);
});
