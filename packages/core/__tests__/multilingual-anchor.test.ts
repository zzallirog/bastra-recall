/**
 * #707: `anchorStrength`'s significance rule does not depend on a language
 * list. A function word is one that fills this vault's bodies (common-terms.ts)
 * — in any language; a vault too small to say keeps every word (the neutral
 * path), so two exact trigger terms make a strong anchor in Russian, Turkish
 * and Greek exactly as in German.
 *
 * Runner: node --import tsx --test packages/core/__tests__/multilingual-anchor.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Vault } from "../src/vault.js";
import { SearchIndex } from "../src/search.js";
async function vaultWith(entries: { id: string; recall_when: string[]; body?: string }[]) {
  const dir = await mkdtemp(path.join(tmpdir(), "bastra-ml-anchor-"));
  for (const e of entries) {
    await writeFile(
      path.join(dir, `${e.id}.md`),
      `---
id: ${e.id}
title: ${e.id}
type: lesson
summary: summary of ${e.id}
topic_path: [t]
tags: [t]
scope: t
recall_when: [${e.recall_when.map((r) => JSON.stringify(r)).join(", ")}]
created: 2020-01-01
updated: 2026-07-01
---

${e.body ?? `body of ${e.id}`}
`,
      "utf8",
    );
  }
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  return { dir, search };
}

test("the vault's own filler words are not a declaration, whatever the language", async (t) => {
  const { dir, search } = await vaultWith([
    { id: "target", recall_when: ["это было давно"] },
    ...Array.from({ length: 30 }, (_, i) => ({
      id: `n-${i}`,
      recall_when: [`заметка ${i}`],
      body: `Это было в понедельник, запись ${i}.`,
    })),
  ]);
  t.after(async () => {
    search.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const hit = search.recall("это было", { k: 40 }).find((h) => h.id === "target");
  assert.ok(hit, "precondition: the memory must be retrieved");
  assert.equal(hit.matched_recall_when, true);
  assert.equal(hit.anchor_strength, "weak", "two words that fill every body do not declare intent");
});

for (const [lang, phrase, query] of [
  ["ru", "перезапуск сервера после обновления", "перезапуск сервера"],
  ["tr", "veritabanı şifresi sıfırlama", "veritabanı şifresi"],
  ["el", "επανεκκίνηση διακομιστή μετά την ενημέρωση", "επανεκκίνηση διακομιστή"],
] as const) {
  test(`#707 ${lang}: two exact trigger terms make a strong anchor without a stopword list`, async (t) => {
    const { dir, search } = await vaultWith([
      { id: "target", recall_when: [phrase] },
      { id: "filler", recall_when: ["something else entirely"] },
    ]);
    t.after(async () => {
      search.stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });
    const hit = search.recall(query, { k: 5 }).find((h) => h.id === "target");
    assert.ok(hit, `${lang} query finds its memory`);
    assert.equal(hit.matched_recall_when, true);
    assert.equal(hit.anchor_strength, "strong");
  });
}
