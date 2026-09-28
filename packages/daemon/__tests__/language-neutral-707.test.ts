/**
 * #707 — the fixed-language places the #679 guard found, each checked with a
 * non-Latin language:
 *
 *   save-similarity  function words are the vault's filler (common-terms.ts),
 *                    not a list; duplicates still score in any language
 *   todo-lane        the tokenizer keeps every script; no task-verb list
 *   tool-handlers    acted-on tokens keep non-Latin words
 *   taxonomy         a convention title in Cyrillic covers its cluster
 *   reflex           a free-standing `/` splits alternatives in any script;
 *                    a language's word for "or" is not a splitter
 *   save-quality     the #159 admission flags come from the user's lexicon
 *                    files only (none shipped): no file, no penalty in any
 *                    language; a code span counts as the fix in any script
 *
 * Runner: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/language-neutral-707.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, SearchIndex, tokenizeWithIdentifiers } from "@bastra-recall/core";
import { Telemetry } from "../src/telemetry.js";
import { setCommonTermSource } from "../src/common-terms.js";
import { fieldSimilarity, DUPLICATE_SIMILARITY_MIN, contentTokens } from "../src/save-similarity.js";
import { extractTopicsFromTodos } from "../src/todo-lane.js";
import { distinctiveTokensForActedOn } from "../src/tool-handlers.js";
import { detectTaxonomyDrift } from "../src/taxonomy.js";
import { phraseMatchesContext } from "../src/reflex.js";
import { scoreSaveQuality } from "../src/save-quality.js";
import type { ToolDeps } from "../src/tool-deps.js";

// ── save-similarity ──────────────────────────────────────────────────

test("#707 similarity: a Russian near-duplicate still scores as one (neutral path, no list)", () => {
  const a = {
    title: "перезапуск сервера после деплоя",
    summary: "Сервер нужно перезапускать после каждого деплоя, иначе кэш устаревает.",
    tags: ["деплой", "сервер"],
    recall_when: ["перезапуск сервера после деплоя"],
  };
  const b = { ...a, summary: "После деплоя сервер перезапускается, иначе кэш устаревает." };
  assert.ok(fieldSimilarity(a, b) >= DUPLICATE_SIMILARITY_MIN, `got ${fieldSimilarity(a, b)}`);
});

test("#707 similarity: two unrelated Russian notes stay apart although they share function words", () => {
  const a = {
    title: "перезапуск сервера",
    summary: "Это нужно и на сервере, и на стенде.",
    tags: ["сервер"],
    recall_when: ["перезапуск сервера на стенде"],
  };
  const b = {
    title: "отпуск в августе",
    summary: "Это нужно и на море, и на даче.",
    tags: ["отпуск"],
    recall_when: ["отпуск в августе на море"],
  };
  assert.ok(fieldSimilarity(a, b) < DUPLICATE_SIMILARITY_MIN, `got ${fieldSimilarity(a, b)}`);
});

/** Stand-in for a vault in which `words` fill a fifth of the memories. */
function withFiller(words: string[], fn: () => void): void {
  setCommonTermSource((t) => words.includes(t));
  try {
    fn();
  } finally {
    setCommonTermSource(null);
  }
}

test("#707 similarity: the vault's filler words are dropped, content words of any script kept", () => {
  withFiller(["the", "and"], () => {
    assert.deepEqual([...contentTokens("the server and the сервер")], ["server", "сервер"]);
  });
});

// ── todo-lane ────────────────────────────────────────────────────────

test("#707 todo-lane: a Cyrillic todo list yields Cyrillic topics (tokenizer keeps every script)", () => {
  const out = extractTopicsFromTodos([
    { content: "перезапуск сервера после миграции" },
    { content: "проверить логи сервера" },
  ]);
  assert.deepEqual(out.topics, ["сервера"]);
});

test("#707 todo-lane: no task-verb list — a short word and the vault's filler never become topics", () => {
  withFiller(["neue"], () => {
    const out = extractTopicsFromTodos([{ content: "add neue Migration" }, { content: "add neue Migration tests" }]);
    assert.deepEqual(out.topics, ["migration"]);
  });
});

// ── tool-handlers (acted-on overlap) ─────────────────────────────────

test("#707 acted-on: Greek content words are kept, the vault's filler dropped", () => {
  withFiller(["which"], () => {
    assert.deepEqual(distinctiveTokensForActedOn("which zebra επανεκκίνηση διακομιστή"), [
      "zebra",
      "επανεκκίνηση",
      "διακομιστή",
    ]);
  });
});

// ── taxonomy ─────────────────────────────────────────────────────────

test("#707 taxonomy: a convention title in Cyrillic covers its cluster", async () => {
  process.env.BASTRA_DRIFT_MIN_CLUSTER = "3";
  const dir = await mkdtemp(join(tmpdir(), "bastra-707-taxonomy-"));
  const day = new Date().toISOString().slice(0, 10);
  const file = (id: string, title: string, scope: string, tags: string[]) =>
    [
      "---",
      `id: ${id}`,
      `title: ${title}`,
      "type: lesson",
      `summary: ${title}`,
      "topic_path:",
      "  - test",
      "tags:",
      ...tags.map((t) => `  - ${t}`),
      `scope: ${scope}`,
      "recall_when:",
      `  - ${title}`,
      `created: ${day}`,
      `updated: ${day}`,
      "---",
      "",
      "body",
      "",
    ].join("\n");
  await mkdir(join(dir, "memories/taxonomy"), { recursive: true });
  await writeFile(join(dir, "memories/taxonomy/conv.md"), file("conv", "конвенция логистика", "taxonomy", ["convention"]));
  for (const i of [1, 2, 3]) await writeFile(join(dir, `m${i}.md`), file(`m${i}`, `заметка ${i}`, "proj", ["логистика"]));
  const vault = new Vault(dir);
  await vault.init();
  try {
    assert.deepEqual(
      detectTaxonomyDrift(vault).map((c) => c.key),
      [],
      "the Cyrillic title word must count as covered",
    );
  } finally {
    await vault.stop?.();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

// ── reflex ───────────────────────────────────────────────────────────

const ctx = (text: string): Set<string> => new Set(tokenizeWithIdentifiers(text.toLowerCase()));

test("#707 reflex: Russian 'или' is not a splitter (no word list) — the phrase gets stricter, '/' splits", () => {
  assert.equal(phraseMatchesContext("письмо или ответ написать", ctx("надо ответ написать")), false, "every content token required");
  assert.equal(phraseMatchesContext("письмо / ответ написать", ctx("надо ответ написать")), true);
});

test("#707 reflex: a free-standing '/' splits alternatives in an unlisted language", () => {
  const phrase = "μήνυμα γράψιμο / απάντηση γράψιμο";
  assert.equal(phraseMatchesContext(phrase, ctx("γράψιμο μήνυμα τώρα")), true);
  assert.equal(phraseMatchesContext("μήνυμα απάντηση γράψιμο", ctx("γράψιμο μήνυμα τώρα")), false, "without '/' every token is required");
});

// ── save-quality (#159 admission flags) ──────────────────────────────

async function makeDeps(): Promise<{ deps: ToolDeps; close: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "bastra-707-quality-"));
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const deps: ToolDeps = { vault, search, telemetry: new Telemetry(), vaultPath: dir };
  return {
    deps,
    close: async () => {
      search.stop();
      await vault.stop?.();
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

function input(title: string, summary: string, body: string) {
  return {
    title,
    type: "lesson",
    summary,
    body,
    topic_path: ["test"],
    tags: ["сервер"],
    scope: "q707",
    recall_when: ["перезапуск сервера после деплоя на стенде"],
  } as Parameters<typeof scoreSaveQuality>[1];
}

const NEGATIVE = "negative capability claim";
const IMPERATIVE = "imperative phrasing";

async function withLexiconDir(files: Record<string, string>, run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bastra-707-lexicon-"));
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content, "utf8");
  const prev = process.env.BASTRA_LEXICON_DIR;
  process.env.BASTRA_LEXICON_DIR = dir;
  try {
    await run();
  } finally {
    if (prev === undefined) delete process.env.BASTRA_LEXICON_DIR;
    else process.env.BASTRA_LEXICON_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

test("#707 save-quality: a user's Russian cue files flag a negative claim without a fix, and an imperative lead", async (t) => {
  const { deps, close } = await makeDeps();
  t.after(close);
  await withLexiconDir({}, async () => {
    const res = scoreSaveQuality(deps, input("Всегда перезапускать сервер", "Сервер не работает после деплоя.", "Пока без идей."), "x");
    assert.ok(!res.issues.some((i) => i.includes(NEGATIVE) || i.includes(IMPERATIVE)), "nothing shipped → no flag");
  });
  const files = {
    "negative-claim.txt": "не\\s+работает\n",
    "fix-marker.txt": "решение\n",
    "imperative-lead.txt": "всегда\n",
  };
  await withLexiconDir(files, async () => {
    const broken = scoreSaveQuality(deps, input("сервер", "Сервер не работает после деплоя.", "Пока без идей."), "x");
    assert.ok(broken.issues.some((i) => i.includes(NEGATIVE)), JSON.stringify(broken.issues));
    const fixed = scoreSaveQuality(deps, input("сервер", "Сервер не работает после деплоя.", "Решение: перезапуск."), "x");
    assert.ok(!fixed.issues.some((i) => i.includes(NEGATIVE)), JSON.stringify(fixed.issues));
    const lead = scoreSaveQuality(deps, input("Всегда перезапускать сервер", "Сервер после деплоя.", "…"), "x");
    assert.ok(lead.issues.some((i) => i.includes(IMPERATIVE)), JSON.stringify(lead.issues));
  });
});

test("#707 save-quality: a code span in the body counts as the captured fix in any script", async (t) => {
  const { deps, close } = await makeDeps();
  t.after(close);
  await withLexiconDir({ "negative-claim.txt": "не\\s+работает\n" }, async () => {
    const res = scoreSaveQuality(deps, input("сервер", "Сервер не работает после деплоя.", "`systemctl restart app`"), "x");
    assert.ok(!res.issues.some((i) => i.includes(NEGATIVE)), JSON.stringify(res.issues));
  });
});

test("#707 save-quality: no lexicon file gets no guessed penalty, and a lexicon file adds the language", async (t) => {
  const { deps, close } = await makeDeps();
  t.after(close);
  const greek = input("διακομιστής", "Ο διακομιστής δεν λειτουργεί μετά την ανάπτυξη.", "Καμία ιδέα ακόμα.");
  await withLexiconDir({}, async () => {
    const res = scoreSaveQuality(deps, greek, "x");
    assert.ok(!res.issues.some((i) => i.includes(NEGATIVE)), "no file → neutral, no penalty");
  });
  await withLexiconDir({ "negative-claim.txt": "δεν\\s+λειτουργεί\n" }, async () => {
    const res = scoreSaveQuality(deps, greek, "x");
    assert.ok(res.issues.some((i) => i.includes(NEGATIVE)), JSON.stringify(res.issues));
  });
});
