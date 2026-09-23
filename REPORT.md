# 017-core-ranking-boundaries

Прочитано: LIBRARY.md 66 строк · JOURNAL.md 41 строка · `packages/core/src` 13 551 · `packages/core/__tests__` 15 399 (wc -l). По файлам целиком: `search.ts` 1748, `rrf.ts` 83, `weak-result.ts` 104, `retrieval-mode.ts` 74, `ranking-order.test.ts` 405, плюс ranking-куски `embeddings.ts` / `related-enrich.ts` / `query-cost.ts` / `recall-candidate-pool.test.ts`.

Зелёный сьют без укуса не доказательство. Что бы его покрасило — в каждой находке.

## Находки

1. **high · `packages/core/src/search.ts:805` (было `filtered.slice(0, HOP_SEED_POOL)`) · A7 не закрыт на окне 20.** `rankBm25` резал MiniSearch до `max(k*4, 20)` *до* damping. k-cut после damping видел только эту двадцатку: свежий hit на сыром ранге 21 не вытеснял 20 expired (×0.2). Тот же `break` стоял на fused-пути (`outFull.length >= HOP_SEED_POOL`). Доказано: k=25 (окно 100) отдаёт `fresh-lo`, k=1 отдавал `expired-00`. Реверт-чек: вернуть `slice(0, HOP_SEED_POOL)` до `applyStaleness` → `A7: a damped winner outside the raw hop-seed window` краснеет.

2. **medium · `search.ts` `applyStaleness` / `embeddings.ts` sort · ничья по score не объявлена.** Компаратор был `b.score - a.score`; JS-stable sort держал insertion order (MiniSearch / path / BM25-arm-first в `fuseRRF`). Два one-arm rank-1 дают один RRF (~81.967) — порядок молча от руки. Доказано: одинаковый текст, файлы `1-zeta.md` / `2-alpha.md` → `[zeta, alpha]`. Починка: `compareByScoreThenId` (score desc, id asc). Реверт-чек: score-only в `applyStaleness` → `equal BM25 scores break ties by id` краснеет.

3. **medium · `search.ts:880` · bm25-only без маркеров, которые обещает tool `recall`.** `recallHybrid` без `useEmbeddings()` зовёт `recall()`. `done.meta` = `{hit_count, vault_size, total_ms}` — нет `degraded` / `score_kind` / `unfused`. Probe: `no_embed_hybrid_mode bm25 done_degraded undefined`. `score_kind`/`unfused` ставит daemon (`hasEmbeddings()`), не core; описание инструмента говорит, что `degraded` именует и «no embedding model». Не чинил: поля ответа живут в daemon, скоуп — core.

4. **low · `embeddings.ts:297-304` / `related-enrich.ts:115` · квадрат не в recall, а в backfill enrich.** 5 000 док × 100 запросов: BM25 86.9 ms (0.87 ms/q), brute-force cosine dim=768 860 ms (8.60 ms/q) — O(n) на запрос, как написано («≤10k <10ms»). `findSimilarById` тот же полный скан; `RelatedEnricher` на каждый embed → backfill 5k это ~5k сканов ≈ 43 s. Не чинил: это ANN, не граница k/min_score.

Дополнительно закрыто тестом, багом не было: `isWeakResult` держал `some`, но в core не кусался (`some`→`every` зеленел весь старый сьют); `valid_until == now` это `>=` expired (`>` даёт `aging`). `min_score` и бэнды 30/100/164/82 в core нет — floor в daemon `recall-handler.ts` (`h.score >= floor`).

## Изменения

- Коммит 1 → damping по полному match-list (hop-seeds по-прежнему raw голова 20); fused-путь без `break` на 20; `compareByScoreThenId` в BM25/RRF/vector sort.
- Коммит 2 → укус `isWeakResult` (some, не every) и `valid_until >= now`.

## Тесты

Канон: `node --import tsx --import ./scripts/test-env.mjs --test <files>` (worktree без своих `node_modules` — symlink на `~/bastra-recall/node_modules`, в коммит не входил).

- ranking-order + rrf-* + recall-candidate-pool + query-cache + vector-arm-deadline **до фикса**: 2 fail (`expired-00` vs `fresh-lo`; `[zeta,alpha]` vs `[alpha,zeta]`).
- Тот же набор **после**: 50 pass / 0 fail.
- Расширенный набор (+ weak-result, valence, doc-damping, search-field-boost): `# tests 60` `# pass 60` `# fail 0`.
- Реверт-чеки (на месте, restore после): A7 window → not ok, actual `expired-00`; id tie-break → not ok, actual `zeta`; `some`→`every` → mixed-list not ok; `validUntil >=`→`>` → actual `aging`.

Что бы покрасило зелёный сьют без новых тестов: вернуть `filtered.slice(0, HOP_SEED_POOL)` или score-only sort. Старый ranking-order A7 (2 документа) оба в окне 20 — не кусает.

## Не сделал и почему

- `score_kind`/`unfused`/`degraded` на MCP-ответе — daemon `recall-handler.ts`, скоуп core.
- ANN / heap top-k для cosine — 8.6 ms на 5k не граница, которую просили сломать.
- Мутация `<`↔`<=` на `min_score` в core невозможна: фильтра нет.

`4 находок / 2 починок`
