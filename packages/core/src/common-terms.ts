/**
 * Function words by frequency, not by list.
 *
 * Every matcher that wants to ignore "the", "für", "для", "cha", "של" used to
 * carry a list of them — for English and German, later Russian — and every
 * other language kept its function words as content: a Polish trigger needed
 * "dla", a Swahili one "cha", and two Turkish notes looked alike because both
 * said "için". A function word is not a property of a language list; it is a
 * word that turns up in a large share of the texts, whatever the language.
 * The texts at hand (the vault's documents, the user's own logged queries)
 * say which words those are for the language this user writes in.
 *
 * Below {@link COMMON_TERM_MIN_DOCS} texts no word is common: a small corpus
 * cannot tell a function word from a topic, and the callers then keep every
 * word — stricter, never "never fires". Short words (`isShortWord`) are the
 * corpus-free half of the same idea (Zipf: the frequent words are short).
 */

/** Fewer texts than this, and frequency says nothing. */
export const COMMON_TERM_MIN_DOCS = 30;
/** A term in at least this share of the texts is filler, not a topic. */
export const COMMON_TERM_MIN_SHARE = 0.2;

export type CommonTermTest = (term: string) => boolean;

/** The test when there is no corpus: nothing is common. */
export const NO_COMMON_TERMS: CommonTermTest = () => false;

/**
 * The common-term test over `docs`, each given as its set (or list) of
 * already folded terms. Counts documents, not occurrences.
 */
export function commonTermsIn(docs: Iterable<Iterable<string>>): CommonTermTest {
  const df = new Map<string, number>();
  let n = 0;
  for (const doc of docs) {
    n++;
    for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  if (n < COMMON_TERM_MIN_DOCS) return NO_COMMON_TERMS;
  const common = new Set<string>();
  for (const [t, c] of df) if (c / n >= COMMON_TERM_MIN_SHARE) common.add(t);
  return common.size === 0 ? NO_COMMON_TERMS : (t) => common.has(t);
}

/** True when `share` of `docCount` documents makes a term common. */
export function isCommonShare(docsWithTerm: number, docCount: number): boolean {
  return docCount >= COMMON_TERM_MIN_DOCS && docsWithTerm / docCount >= COMMON_TERM_MIN_SHARE;
}
