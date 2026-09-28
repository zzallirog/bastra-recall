/**
 * Tests for src/learned-recall/language.ts — language facts from CLDR data and
 * scripts, no function-word lists (lang-parity; the de/en detector is gone).
 *
 * Run: npx tsx --test packages/daemon/__tests__/learned-recall-language.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { foldTerm, sameWordForm } from "@bastra-recall/core";

import {
  bridgeLanguage,
  isBridgeLanguage,
  isSupportedLanguage,
  namedLanguage,
  scriptShare,
  scriptsOf,
  UNDETERMINED_LANGUAGE,
} from "../src/learned-recall/language.js";

test("isSupportedLanguage accepts every language CLDR names, not a list of two", () => {
  for (const ok of ["de", "en", "fr", "ru", "uk", "sw", "vi", "he", "yue"]) assert.equal(isSupportedLanguage(ok), true, ok);
  for (const bad of ["xx", "qq", "DE", "de-DE", "und-x", "", 42, null]) assert.equal(isSupportedLanguage(bad), false, String(bad));
});

test("scriptsOf reads the writing system from CLDR likely subtags", () => {
  assert.deepEqual(scriptsOf("ru"), ["Cyrl"]);
  assert.deepEqual(scriptsOf("ja"), ["Hani", "Hira", "Kana"]);
  assert.deepEqual(scriptsOf("ko"), ["Hang", "Hani"]);
  assert.deepEqual(scriptsOf("hi"), ["Deva"]);
  assert.deepEqual(scriptsOf("sw"), ["Latn"]);
});

test("scriptShare counts words in the language's script — any language, same rule", () => {
  assert.equal(scriptShare("обнови деплой", "ru"), 1);
  assert.equal(scriptShare("update the deploy", "ru"), 0);
  assert.ok((scriptShare("рефакторинг checkout payment retry", "ru") ?? 0) > 0.2, "tech anchors do not drown a Russian trigger");
  assert.equal(scriptShare("デプロイ script", "ja"), 0.5);
  assert.equal(scriptShare("12345 !!!", "ru"), null, "no words, no verdict");
});

test("#707: a bridge files under und unless a language is configured — the folder is never guessed", () => {
  assert.equal(UNDETERMINED_LANGUAGE, "und");
  for (const q of ["wie kann ich das Feld in der Datenbank speichern", "почему сервер падает ночью", "NSPanel resignKey"]) {
    assert.equal(bridgeLanguage(q), "und", q);
  }
});

test("#707: isBridgeLanguage checks the folder shape, not a language list", () => {
  for (const ok of ["de", "en", "und", "ru", "tr", "el"]) assert.equal(isBridgeLanguage(ok), true, ok);
  for (const bad of ["archive", "../x", "", "DE", "de-DE", 42, null]) assert.equal(isBridgeLanguage(bad), false, String(bad));
});

test("namedLanguage finds the language a text names, in that language's own name", () => {
  const named = (t: string) => namedLanguage(t, sameWordForm, foldTerm);
  assert.equal(named("Deutsch, Du-Form"), "de");
  assert.equal(named("на русском, кратко"), "ru");
  assert.equal(named("日本語で"), "ja");
  assert.equal(named("بالعربية"), "ar");
  assert.equal(named("Daniel, terse"), null, "a first name is not Danish");
  assert.equal(named("TypeScript Node Postgres"), null);
});
