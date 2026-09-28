/**
 * Language-neutral word primitives — one place that decides what a word is
 * and when two words are the same word.
 *
 * Before this module every matcher carried its own answer: an ASCII
 * `[a-z0-9]` scan on the tool-input side of acted_on, `\p{L}` runs on the
 * memory side, exact `Set.has` in reflex, a raw two-way `startsWith` in the
 * weak-result title check. Each answer was right for English and German and
 * wrong somewhere else: a Cyrillic memory could never become acted_on, a
 * Russian case ending ("арка" / "арке") missed every reflex trigger, a
 * one-letter preposition in a title anchored every query, and Japanese —
 * written without spaces — reached every matcher as one sentence-long token.
 *
 * Two rules, no word lists, no language detection:
 *
 * 1. `segmentWords` — scripts written without spaces between words (Han,
 *    Hiragana, Katakana, Thai, Lao, Khmer, Myanmar) are split by ICU word
 *    segmentation (`Intl.Segmenter`, full ICU ships with Node). Every other
 *    run is returned unchanged, so identifier handling upstream of this
 *    stays exactly as it was.
 * 2. `sameWordForm` — two tokens are the same word when they differ only in
 *    an ending: a long enough common prefix and a short enough length gap.
 *    This is the inflection rule of every language that inflects by suffix
 *    (Russian, German, English, Japanese okurigana) and it needs no stemmer.
 *    Short tokens (< 4 characters) stay exact — a two-letter prefix says
 *    nothing.
 */

const SPACELESS_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

let segmenter: Intl.Segmenter | null | undefined;

function wordSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    try {
      segmenter = new Intl.Segmenter("und", { granularity: "word" });
    } catch {
      // small-icu builds: no segmentation, runs stay whole (the old behaviour)
      segmenter = null;
    }
  }
  return segmenter;
}

/** True when `token` contains a character of a script written without spaces. */
export function hasSpacelessScript(token: string): boolean {
  return SPACELESS_SCRIPT_RE.test(token);
}

/**
 * Split one raw token into words. A token without a spaceless-script
 * character is returned as-is (`["my-app.config.ts"]`); a token with one is
 * split into ICU word segments, punctuation dropped.
 */
export function segmentWords(token: string): string[] {
  if (!hasSpacelessScript(token)) return [token];
  const seg = wordSegmenter();
  if (!seg) return [token];
  const out: string[] = [];
  for (const s of seg.segment(token)) {
    if (s.isWordLike) out.push(s.segment);
  }
  return out.length > 0 ? out : [token];
}

const HIRAGANA_ONLY_RE = /^\p{Script=Hiragana}+$/u;

/**
 * Does `token` carry meaning on its own? A Latin or Cyrillic word of two
 * letters is a function word; a two-character Han or Katakana word (移行,
 * 起動, モード) is a content word. `minLen` is the threshold for alphabetic
 * scripts; spaceless scripts need two characters.
 *
 * A token written only in Hiragana is grammar — particles, auxiliaries and
 * conjugation endings (を, する, とき, ない); Japanese writes its content words
 * in Kanji or Katakana. A trigger such as "公開リポジトリにプッシュするとき"
 * otherwise demanded "する" and "とき" from a prompt that said "プッシュして".
 * A rule of the script, not a word list.
 */
export function isSignificantLength(token: string, minLen: number): boolean {
  const len = [...token].length;
  if (HIRAGANA_ONLY_RE.test(token)) return false;
  if (hasSpacelessScript(token)) return len >= Math.min(2, minLen);
  return len >= minLen;
}

const LETTERS_ONLY_RE = /^[\p{L}\p{M}]+$/u;
/** Below this many characters two different tokens are never one word. */
export const WORD_FORM_MIN_LEN = 4;
/** An ending longer than this is a different word, not an inflection. */
const WORD_FORM_MAX_GAP = 3;

/**
 * Are `a` and `b` forms of the same word? Case-sensitive — callers compare
 * lowercased tokens. Exact equality always holds. Otherwise both must be
 * letters only (identifiers, numbers and paths stay exact), the shorter at
 * least `WORD_FORM_MIN_LEN` characters, the lengths at most
 * `WORD_FORM_MAX_GAP` apart, and the common prefix must cover the shorter
 * token except its last character (≤ 5 characters) or its last two (longer).
 *
 *   арка ~ арке ~ арку · снял ~ снять · забрать ~ забрал · Antwort ~ antworten
 *   切り替え ~ 切り替える · update ~ updated
 *   state ≁ statement (gap 4) · code ≁ card · ci ≁ cd (too short)
 */
export function sameWordForm(a: string, b: string): boolean {
  if (a === b) return true;
  const ca = [...a];
  const cb = [...b];
  const min = Math.min(ca.length, cb.length);
  if (min < WORD_FORM_MIN_LEN) return false;
  if (Math.abs(ca.length - cb.length) > WORD_FORM_MAX_GAP) return false;
  if (!LETTERS_ONLY_RE.test(a) || !LETTERS_ONLY_RE.test(b)) return false;
  let prefix = 0;
  while (prefix < min && ca[prefix] === cb[prefix]) prefix++;
  const need = Math.max(3, min <= 5 ? min - 1 : min - 2);
  return prefix >= need;
}

/**
 * Does `tokens` contain a form of `word`? Exact lookup first (O(1)); the
 * word-form scan only runs when the exact lookup misses.
 */
export function hasWordForm(tokens: ReadonlySet<string>, word: string): boolean {
  if (tokens.has(word)) return true;
  if ([...word].length < WORD_FORM_MIN_LEN) return false;
  for (const t of tokens) {
    if (sameWordForm(word, t)) return true;
  }
  return false;
}
