/**
 * The daemon's one answer to "is this word filler?" — the vault's own
 * frequency (core common-terms.ts), not a list per language.
 *
 * The matchers that need it (reflex phrases, save similarity, acted_on, todo
 * topics, trigger genericity, bridge terms) sit several calls deep under
 * handlers that do not carry the search index, so the server that owns the
 * index registers it here once (`startHttpServer`). Nothing registered — a
 * CLI run, a unit test — means nothing is common: every word counts, which is
 * the stricter reading, never a lost match.
 */
import { NO_COMMON_TERMS, foldTerm, type CommonTermTest } from "@bastra-recall/core";

let source: CommonTermTest = NO_COMMON_TERMS;

/** Register the index whose documents decide what is common (or reset). */
export function setCommonTermSource(test: CommonTermTest | null): void {
  source = test ?? NO_COMMON_TERMS;
}

/** Is `term` in at least a fifth of the vault's memories? Folds first. */
export function isCommonTerm(term: string): boolean {
  return source(foldTerm(term));
}
