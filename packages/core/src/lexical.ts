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
 * Rules, no word lists, no language detection:
 *
 * 1. `normalizeText` / `foldTerm` — the one spelling every matcher compares:
 *    NFKC (NFD text from macOS, fullwidth ＡＰＩ and half-width ｶﾅ from an
 *    IME), invisible format characters (ZWSP, ZWNJ, soft hyphen, bidi marks)
 *    and Arabic tatweel removed, the optional vowel points of the abjads
 *    (Hebrew niqqud, Arabic harakat) dropped; `foldTerm` adds a case fold that
 *    does not depend on the host locale and treats Turkish İ/ı and German ß
 *    like their pairs ("İ" and "ı" both fold to "i", "ß" to "ss").
 * 2. `segmentWords` — scripts written without spaces between words (Unicode
 *    line-break classes ID and SA: Han, Kana, Bopomofo, Yi, Thai, Lao, Khmer,
 *    Myanmar, the Tai scripts; Tibetan separates syllables with the tsheg)
 *    are split by ICU word segmentation (`Intl.Segmenter`, full ICU ships with
 *    Node). Every other run is returned unchanged, so identifier handling
 *    upstream of this stays exactly as it was.
 * 3. `letterCount` — a word's length is its letters, not its code points:
 *    Devanagari vowel signs and Hebrew/Arabic points are marks and do not
 *    count ("में" is one letter), a Hangul syllable counts its jamo ("배포" is
 *    four), so every length threshold means the same thing in every script.
 * 4. `sameWordForm` — two tokens are the same word when they differ only in
 *    affixes: a long enough common stem with a short ending (every suffixing
 *    language), a long ending on a long stem (agglutination: Finnish, Turkish,
 *    Korean particles), or a short prefix before the stem (Arabic al-/bi-/wa-,
 *    Hebrew ha-/be-/le-, Bantu noun classes). Short tokens stay exact.
 */

/**
 * Scripts whose words are not separated by spaces: Unicode line-break class ID
 * (ideographs, kana, Bopomofo, Yi, Tangut, Nüshu, Khitan) and SA (the South East
 * Asian scripts ICU breaks by dictionary or syllable), plus Tibetan, whose
 * tsheg separates syllables, not words. A property of the script, not a list
 * of languages: every language written in one of them gets the same rule.
 */
const SPACELESS_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\p{Script=Yi}\p{Script=Tangut}\p{Script=Nushu}\p{Script=Khitan_Small_Script}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tai_Tham}\p{Script=Tai_Viet}\p{Script=New_Tai_Lue}\p{Script=Tai_Le}\p{Script=Ahom}\p{Script=Tibetan}]/u;

const ASCII_RE = /^[\x00-\x7f]*$/;
/** Invisible format characters (ZWSP, ZWNJ, ZWJ, soft hyphen, bidi marks,
 *  BOM) and Arabic tatweel: typography, never part of a word's identity. */
const INVISIBLE_RE = /[\p{Cf}\u0640]/gu;
/** The optional vowel points of the abjads: niqqud, harakat, shadda. Written
 *  in textbooks and poetry, left out everywhere else — the word is the same. */
const ABJAD_POINT_RE = /(?=\p{Mn})[\p{Script_Extensions=Hebrew}\p{Script_Extensions=Arabic}\p{Script_Extensions=Syriac}]/gu;
/** An apostrophe between two letters of a non-Latin script is part of the
 *  word — the Ukrainian/Belarusian apostrophe ("п'ятниця", "обʼєкт"), the
 *  Hebrew geresh typed as "'" ("סטייג'ינג") — and would otherwise split it
 *  into fragments. Latin keeps the split: there it marks elision and
 *  contraction ("l'état", "don't"). */
const INWORD_APOSTROPHE_RE = /(?<=(?!\p{Script=Latin})\p{L}\p{M}*)['\u2019\u02bc\u05f3](?=(?!\p{Script=Latin})\p{L})/gu;

/**
 * The spelling every matcher compares, case left alone: NFKC, invisible
 * format characters and tatweel removed, abjad vowel points dropped, an
 * in-word apostrophe of a non-Latin script joined. Pure, idempotent; identity
 * for ASCII.
 */
export function normalizeText(text: string): string {
  if (ASCII_RE.test(text)) return text;
  return text
    .normalize("NFKC")
    .replace(INVISIBLE_RE, "")
    .replace(ABJAD_POINT_RE, "")
    .replace(INWORD_APOSTROPHE_RE, "")
    .normalize("NFC");
}

/**
 * `normalizeText` plus a case fold that is the same on every host. `toLowerCase`
 * alone leaves "ß" ≠ "SS"→"ss", and turns Turkish "İ" into "i" + a combining
 * dot, so a Turkish word typed in capitals never met its lowercase form. The
 * round trip through upper case folds ß/ẞ, final sigma and long s; the dotted
 * and dotless i of Turkish fold to "i" together (on a keyboard without them
 * users type i/I anyway). Idempotent.
 */
export function foldTerm(term: string): string {
  if (ASCII_RE.test(term)) return term.toLowerCase();
  return normalizeText(term).toUpperCase().toLowerCase().replace(/i\u0307/g, "i");
}

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
const LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

/**
 * How many letters (and digits) `token` has, marks not counted: canonical
 * decomposition first, so a precomposed "é" is one letter, a Devanagari vowel
 * sign or virama is none ("में" = 1, "स्क्रिप्ट" = 5) and a Hangul syllable
 * counts its jamo ("배포" = 4 — a Korean syllable carries what two or three
 * Latin letters do). Code points overcount Indic words and undercount Korean
 * ones; letters make one threshold mean the same thing in every script.
 */
export function letterCount(token: string): number {
  if (ASCII_RE.test(token)) {
    let n = 0;
    for (let i = 0; i < token.length; i++) {
      const c = token.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) n++;
    }
    return n;
  }
  let n = 0;
  for (const ch of token.normalize("NFD")) if (LETTER_OR_DIGIT_RE.test(ch)) n++;
  return n;
}

/**
 * Does `token` carry meaning on its own? A Latin or Cyrillic word of two
 * letters is a function word; a two-character Han or Katakana word (移行,
 * 起動, モード) is a content word. `minLen` is the threshold in letters
 * (`letterCount`) for alphabetic scripts; spaceless scripts need two
 * characters.
 *
 * A token written only in Hiragana is grammar — particles, auxiliaries and
 * conjugation endings (を, する, とき, ない); Japanese writes its content words
 * in Kanji or Katakana. A trigger such as "公開リポジトリにプッシュするとき"
 * otherwise demanded "する" and "とき" from a prompt that said "プッシュして".
 * A rule of the script, not a word list.
 */
export function isSignificantLength(token: string, minLen: number): boolean {
  if (HIRAGANA_ONLY_RE.test(token)) return false;
  if (hasSpacelessScript(token)) return [...token].length >= Math.min(2, minLen);
  return letterCount(token) >= minLen;
}

/**
 * Is `token` one of the short words every language fills its sentences with
 * (articles, prepositions, particles, "the", "für", "для", "cha", "של")?
 * Zipf's law of abbreviation: the most frequent words of a language are its
 * shortest, in every language — so length, not a list, marks them. Up to
 * {@link SHORT_WORD_MAX_LETTERS} letters in an alphabetic script, one
 * character in a spaceless one. Callers treat such a token as optional next
 * to longer content words, never as absent: "git push" still needs "git".
 */
export const SHORT_WORD_MAX_LETTERS = 3;
export function isShortWord(token: string): boolean {
  if (hasSpacelessScript(token)) return [...token].length <= 1;
  return letterCount(token) <= SHORT_WORD_MAX_LETTERS;
}

const LETTERS_ONLY_RE = /^[\p{L}\p{M}]+$/u;
/** Below this many letters two different tokens are never one word. */
export const WORD_FORM_MIN_LEN = 4;
/** The abjads write consonants only: a three-letter Hebrew or Arabic word
 *  (ספר, كتب) carries what a five- or six-letter Latin word does. */
const ABJAD_WORD_FORM_MIN_LEN = 3;
const ABJAD_RE = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
/** An ending longer than this is a different word, not an inflection… */
const WORD_FORM_MAX_GAP = 3;
/** …unless the stem itself is at least this long: agglutinative endings
 *  (Finnish -ssakin, Turkish -larında, Korean particle chains) are long, but
 *  they hang on long stems. */
const LONG_STEM = 6;
/** A prefix (article, clitic, noun-class marker) is at most this long. */
const WORD_FORM_MAX_PREFIX = 3;
/** The stem a prefix is stripped against must be this long outside the
 *  abjads — shorter stems rhyme by accident ("range"/"orange"). */
const PREFIXED_STEM_MIN = 6;

function minWordFormLetters(token: string): number {
  return ABJAD_RE.test(token) ? ABJAD_WORD_FORM_MIN_LEN : WORD_FORM_MIN_LEN;
}

/**
 * The characters `sameWordForm` compares: canonical decomposition with every
 * combining mark kept on its base letter, so "й", "é" and a Devanagari
 * consonant with its vowel sign each stay one character, while a Hangul
 * syllable opens into its jamo (letters in their own right, not marks).
 */
function formUnits(token: string): string[] {
  const out: string[] = [];
  for (const ch of token.normalize("NFD")) {
    if (out.length > 0 && COMBINING_MARK_RE.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}
const COMBINING_MARK_RE = /\p{M}/u;

function indexOfRun(hay: string[], needle: string[], from: number, to: number): number {
  outer: for (let i = from; i <= to && i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Are `a` and `b` forms of the same word? Case-sensitive — callers compare
 * folded tokens (`foldTerm`). Exact equality always holds. Otherwise both
 * must be letters only (identifiers, numbers and paths stay exact), the
 * shorter at least `WORD_FORM_MIN_LEN` letters (three in the abjads), and one
 * of three shapes must hold, compared on canonically decomposed characters:
 *
 * - suffix: the common prefix covers the shorter token except its last
 *   character (≤ 5 characters) or its last two, and the lengths are at most
 *   `WORD_FORM_MAX_GAP` apart — or any distance when the shared stem is the
 *   whole shorter token less one character and at least `LONG_STEM` long;
 * - prefix: the shorter token, less at most two trailing characters, sits
 *   inside the longer one after a prefix of one to `WORD_FORM_MAX_PREFIX`
 *   characters (or with its first character swapped for another one), with
 *   at most `WORD_FORM_MAX_GAP` after it; that stem needs `PREFIXED_STEM_MIN`
 *   characters outside the abjads.
 *
 *   арка ~ арке · Antwort ~ antworten · 切り替え ~ 切り替える · update ~ updated
 *   laskun ~ laskuissa · şablonu ~ şablonlarında · 청구서 ~ 청구서들을
 *   قالب ~ بالقالب · חשבונית ~ החשבוניות · kiolezo ~ violezo
 *   state ≁ statement · range ≁ orange · code ≁ card · ci ≁ cd
 */
export function sameWordForm(a: string, b: string): boolean {
  if (a === b) return true;
  if (!LETTERS_ONLY_RE.test(a) || !LETTERS_ONLY_RE.test(b)) return false;
  const ua = formUnits(a);
  const ub = formUnits(b);
  const [s, l] = ua.length <= ub.length ? [ua, ub] : [ub, ua];
  const shorter = s === ua ? a : b;
  const minLetters = minWordFormLetters(shorter);
  if (letterCount(shorter) < minLetters) return false;
  const gap = l.length - s.length;

  let prefix = 0;
  while (prefix < s.length && s[prefix] === l[prefix]) prefix++;
  if (prefix === s.length && gap === 0) return true; // NFC vs NFD spelling
  // A three-character stem has no ending to spare: ספר ~ ספרים, not ספר ~ ספק.
  const need = s.length <= 3 ? s.length : Math.max(3, s.length <= 5 ? s.length - 1 : s.length - 2);
  if (prefix >= need && gap <= WORD_FORM_MAX_GAP) return true;
  // A long ending needs the whole shorter token (less one character) as its
  // stem: laskun ~ laskuissa, not contract ~ contradiction.
  if (prefix >= Math.max(LONG_STEM, s.length - 1)) return true;

  const stemMin = minLetters === WORD_FORM_MIN_LEN ? PREFIXED_STEM_MIN : ABJAD_WORD_FORM_MIN_LEN;
  for (let lead = 0; lead <= 1; lead++) {
    for (let trail = 0; trail <= 2; trail++) {
      const stem = s.slice(lead, s.length - trail);
      if (stem.length < stemMin) continue;
      // A changed first character is a swapped prefix of the same size
      // (ki-/vi-, ال/لل), not room for a longer one (decision ≁ precision).
      const at = indexOfRun(l, stem, 1, lead === 1 ? 1 : WORD_FORM_MAX_PREFIX);
      if (at < 0) continue;
      if (l.length - at - stem.length <= WORD_FORM_MAX_GAP) return true;
    }
  }
  return false;
}

/** A query word needs this many letters before its stem is tried as well. */
const STEM_VARIANT_MIN_LETTERS = 7;
/** …and the stem keeps at least this many: a short stem prefixes everything. */
const STEM_MIN_LETTERS = 5;

/**
 * The stems of a long query word, for a PREFIX search: the word less one to
 * three trailing characters, each still at least five letters long.
 * "skriptillä" → "skripti…", "deploying" → "deploy", "스크립트를" → "스크립트".
 * The suffix rule of `sameWordForm`, turned around for an index that only
 * matches a query term as the prefix of a stored one: an inflected query word
 * then still reaches the stored base form — in every suffixing language, with
 * no stemmer. Letters-only words of spaced scripts only.
 */
export function stemVariants(term: string): string[] {
  if (!LETTERS_ONLY_RE.test(term) || hasSpacelessScript(term)) return [];
  if (letterCount(term) < STEM_VARIANT_MIN_LETTERS) return [];
  const chars = [...term.normalize("NFC")];
  const out: string[] = [];
  for (let cut = 1; cut <= 3; cut++) {
    const stem = chars.slice(0, chars.length - cut).join("");
    if (letterCount(stem) >= STEM_MIN_LETTERS) out.push(stem);
  }
  return out;
}

/**
 * Does `tokens` contain a form of `word`? Exact lookup first (O(1)); the
 * word-form scan only runs when the exact lookup misses.
 */
export function hasWordForm(tokens: ReadonlySet<string>, word: string): boolean {
  if (tokens.has(word)) return true;
  if (letterCount(word) < ABJAD_WORD_FORM_MIN_LEN) return false;
  for (const t of tokens) {
    if (sameWordForm(word, t)) return true;
  }
  return false;
}

// ─── questions ──────────────────────────────────────────────────────────────

/** A question mark that ends a clause: after a letter, digit or closing
 *  quote/bracket, and followed by whitespace, "!", another question mark, a
 *  closing quote/bracket or the end — not the `?` of `a?.b` or a URL query.
 *  French typography puts a space before it ("c'est quoi ?"); then only the
 *  end of the clause may follow, so `x ?? y` stays code. */
const QUESTION_END_RE =
  /[\p{L}\p{M}\p{N}"'»”’)\]}」』](?:[?？؟\u037e፧‽⁇⁈⁉](?=[\s?？!！"'»”’)」』*_`]|$)|[\u0020\u00a0\u202f][?？؟\u037e፧‽⁇⁈⁉](?=[!！]*(?:\s|$)))/u;
/** Greek writes its question mark as the semicolon key: a ";" after a Greek
 *  word at the end of a line. Anywhere else ";" is a semicolon. */
const GREEK_QUESTION_RE = /\p{Script=Greek}\p{M}*;[ \t]*(?:\n|$)/u;
/** A question opened explicitly: Spanish ¿, and the Armenian question mark,
 *  which sits inside the word it questions. */
const QUESTION_OPEN_RE = /[¿՞]/u;

/**
 * Is `text` a question — in any script? A clause ending in ? ？ ؟ ፧ ‽ (also
 * after the French space), the Greek ";" after a Greek word at the end of a
 * line, or an opening ¿ / ՞. A property of punctuation every script has, not
 * of question words; code (`a?.b`, `x ?? y`) and URL queries are not.
 */
export function isQuestion(text: string): boolean {
  return QUESTION_END_RE.test(text) || GREEK_QUESTION_RE.test(text) || QUESTION_OPEN_RE.test(text);
}
