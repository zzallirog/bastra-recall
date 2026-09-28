/**
 * Language facts without word lists (#120, #707, lang-parity).
 *
 * This module used to guess a text's language from German and English
 * function words (plus "any ä/ö/ü/ß is German"): Finnish, Swedish and Turkish
 * came out German, Italian and Portuguese English, and every other language
 * "und". The guess filed bridges, fell back for the onboarding language and
 * drove the "triggers read as English" save advisory — each one right for
 * de/en only.
 *
 * What replaces it knows no words:
 * - a language code is anything CLDR knows (`Intl`), not a list of two;
 * - the script a language is written in comes from CLDR likely subtags
 *   (`Intl.Locale#maximize`: ru → Cyrl, ja → Hani+Hira+Kana, hi → Deva), and
 *   `scriptShare` measures how much of a text is written in it — a question
 *   every language answers the same way;
 * - a bridge is filed under the configured query language or "und" — the
 *   folder never decided whether a bridge mints or fires (#707), so there is
 *   nothing to guess.
 */

/** A language value: a primary language subtag CLDR can name ("de", "sw",
 *  "yue"). Kept as a named type for the settings and CLI call sites. */
export type SupportedLanguage = string;

let displayNames: Intl.DisplayNames | null | undefined;
function englishNames(): Intl.DisplayNames | null {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
    } catch {
      displayNames = null;
    }
  }
  return displayNames;
}

/**
 * Is `v` a language CLDR knows — a 2–3 letter primary subtag with a name?
 * Accepts every language the ICU data names, rejects shapes and unknown codes.
 */
export function isSupportedLanguage(v: unknown): v is SupportedLanguage {
  if (typeof v !== "string" || !/^[a-z]{2,3}$/.test(v)) return false;
  const names = englishNames();
  if (!names) return true; // small-icu build: the shape check is all there is
  try {
    return names.of(v) !== undefined;
  } catch {
    return false;
  }
}

/** ISO 15924 composite codes CLDR uses for languages that mix scripts. */
const COMPOSITE_SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  Jpan: ["Hani", "Hira", "Kana"],
  Kore: ["Hang", "Hani"],
  Hans: ["Hani"],
  Hant: ["Hani"],
  Hanb: ["Hani", "Bopo"],
};

/** The scripts `lang` is written in (CLDR likely subtags), or null. */
export function scriptsOf(lang: string): string[] | null {
  try {
    const script = new Intl.Locale(lang).maximize().script;
    if (!script) return null;
    return [...(COMPOSITE_SCRIPTS[script] ?? [script])];
  } catch {
    return null;
  }
}

const scriptRegexCache = new Map<string, RegExp | null>();
function scriptRegex(scripts: readonly string[]): RegExp | null {
  const key = scripts.join("+");
  if (!scriptRegexCache.has(key)) {
    try {
      scriptRegexCache.set(key, new RegExp(`[${scripts.map((s) => `\\p{Script=${s}}`).join("")}]`, "u"));
    } catch {
      scriptRegexCache.set(key, null);
    }
  }
  return scriptRegexCache.get(key) ?? null;
}

/**
 * The share (0..1) of the words of `text` that are written (at least partly)
 * in a script `lang` is written in, or null when the text has no words or the
 * language's script is unknown. Counted by words, not letters, so the long
 * Latin tech anchors a Russian or Japanese trigger keeps ("checkout payment
 * retry") do not outweigh its own words. "обнови деплой" for ru → 1;
 * "update the deploy" for ru → 0.
 */
export function scriptShare(text: string, lang: string): number | null {
  const scripts = scriptsOf(lang);
  if (!scripts) return null;
  const re = scriptRegex(scripts);
  if (!re) return null;
  const words = text.match(/[\p{L}\p{M}\p{N}]*\p{L}[\p{L}\p{M}\p{N}]*/gu) ?? [];
  if (words.length === 0) return null;
  return words.filter((w) => re.test(w)).length / words.length;
}

/** #707: the folder for bridges no configured language claims. */
export const UNDETERMINED_LANGUAGE = "und";

/** #707: the folder a bridge minted from `text` is filed under. Without a
 *  configured query language (the caller's override) that is "und": the
 *  folder only files, it never gated a mint or a fire, so it is not guessed
 *  from words. `text` stays in the signature for the callers. */
export function bridgeLanguage(_text: string): string {
  return UNDETERMINED_LANGUAGE;
}

/** A bridge folder name: a 2–3 letter language code ("de", "en", "und", and
 *  whatever a Commons clone adds). The shape check keeps a cloned file's `lang`
 *  out of path tricks without naming languages. */
export function isBridgeLanguage(v: unknown): v is string {
  return typeof v === "string" && /^[a-z]{2,3}$/.test(v);
}

/**
 * The language a text NAMES ("Deutsch, Du-Form", "на русском", "日本語で",
 * "English please"), from CLDR display names — every language's own name and
 * its name in English — compared word-form tolerant, earliest mention first.
 * Null when the text names none.
 */
export function namedLanguage(
  text: string,
  sameWord: (a: string, b: string) => boolean,
  fold: (s: string) => string,
): SupportedLanguage | null {
  const words = (fold(text).match(/[\p{L}\p{M}]+/gu) ?? []);
  if (words.length === 0) return null;
  // An inflected name keeps the whole name as its stem ("на русском",
  // "suomeksi") or carries it behind a prefix ("بالعربية", "בעברית"); a first
  // name that merely resembles one ("Daniel" ~ Danish, "kurz" ~ Kurdish) does
  // neither.
  const same = (w: string, p: string): boolean =>
    w === p ||
    (sameWord(w, p) && (sharedPrefix(w, p) >= Math.min(5, [...p].length - 1) || ([...p].length >= 4 && w.includes(p))));
  let best: { code: string; pos: number } | null = null;
  for (const [code, names] of languageNames(fold)) {
    for (const name of names) {
      const parts = name.match(/[\p{L}\p{M}]+/gu) ?? [];
      // Spaceless scripts write the name inside a longer run ("日本語で", "中文，").
      const spaceless = parts.length === 1 && SPACELESS_NAME_RE.test(parts[0]);
      if (parts.length === 0 || parts.some((p) => [...p].length < (spaceless ? 2 : 3))) continue;
      const pos = spaceless
        ? words.findIndex((w) => w.includes(parts[0]))
        : words.findIndex((_, i) => parts.every((p, k) => i + k < words.length && same(words[i + k], p)));
      if (pos >= 0 && (!best || pos < best.pos)) best = { code, pos };
    }
  }
  return best?.code ?? null;
}

const SPACELESS_NAME_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function sharedPrefix(a: string, b: string): number {
  const ca = [...a];
  const cb = [...b];
  let n = 0;
  while (n < ca.length && n < cb.length && ca[n] === cb[n]) n++;
  return n;
}

let namesCache: Map<string, string[]> | null = null;
/** code → [endonym, English name], for every two-letter code CLDR names. */
function languageNames(fold: (s: string) => string): Map<string, string[]> {
  if (namesCache) return namesCache;
  const out = new Map<string, string[]>();
  const en = englishNames();
  if (en) {
    const a = "a".charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(a + i, a + j);
        let english: string | undefined;
        try {
          english = en.of(code);
        } catch {
          english = undefined;
        }
        if (!english) continue;
        let own: string | undefined;
        try {
          own = new Intl.DisplayNames([code], { type: "language", fallback: "none" }).of(code);
        } catch {
          own = undefined;
        }
        out.set(code, [...new Set([own, english].filter((n): n is string => !!n).map(fold))]);
      }
    }
  }
  namesCache = out;
  return out;
}
