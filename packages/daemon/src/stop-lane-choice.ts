/**
 * Language-neutral decision signal for the stop lane (#707) — the decision
 * counterpart of stop-lane-repeat.ts (#678).
 *
 * Decisions used to be recognised by cue words (lexicon.ts, de/en/ru); a
 * decision typed in any other language never fired. This signal needs no
 * word list: the agent laid out options and asked, and the user's next turn
 * picks one of them —
 *
 * - by its number or letter ("2", "вариант 2", "2 lütfen", "το 2", "٢"), or
 * - by its name: the reply names what only ONE option says ("ok, we go with
 *   Postgres", "берём Postgres", "Postgresilla", "Postgres로 가자").
 *
 * Deliberately narrow. The assistant turn needs at least two numbered lines
 * AND a question mark (a numbered list of steps is not a choice); a pick by
 * number must be short and name exactly one offered number; a pick by name
 * must not itself be a question, and must name exactly one option.
 */
import { foldTerm, hasWordForm, isQuestion, isSignificantLength, normalizeText, segmentWords } from "@bastra-recall/core";

/** A numbered or lettered list line: "1. …", "2) …", "(3) …", "**3.** …",
 *  "- 4. …", "### 5. …", "B) …", "б) …" — with the rest of the line (the
 *  option's label) captured. */
const OPTION_LINE_RE = /^[ \t]*(?:[-*][ \t]+|#{1,6}[ \t]+)?\**\(?(\d{1,2}|\p{L})[.)]\**[ \t]+(\S[^\n]*)$/gmu;
/** Question marks across scripts: Latin/fullwidth/Arabic/Greek. */
const QUESTION_RE = /[?？؟\u037E]/u;
/** A standalone number — not part of a Latin identifier ("v2", "2nd"), a
 *  version or a longer number. Other scripts may touch it: CJK writes "2で",
 *  "案2" without a space. */
const STANDALONE_NUMBER_RE = /(?<![\p{N}\p{Script=Latin}.])\d{1,2}(?![\p{N}\p{Script=Latin}]|\.\d)/gu;
/** A lone letter answer ("B", "б)") — the pick for a lettered option list. */
const LONE_LETTER_RE = /^[\s(\[*]*(\p{L})[\s.)\]*!]*$/u;
/** A pick is a short answer, not a new request that happens to contain a digit. */
const PICK_MAX_CHARS = 60;
/** A pick by name may say why ("we already know how to run it"), but a long
 *  turn is a new request that mentions an option in passing. */
const NAME_PICK_MAX_CHARS = 240;
const MIN_OPTIONS = 2;

export interface ChoiceTurn {
  role: string;
  content: string;
}

/**
 * Digits of every script (fullwidth, Arabic-Indic, Devanagari…) read as ASCII.
 * Nd blocks are runs of ten, so a digit's value is its offset in the run, mod 10.
 */
function asciiDigits(text: string): string {
  return text.replace(/(?![0-9])\p{Nd}/gu, (d) => {
    let cp = d.codePointAt(0)!;
    let offset = 0;
    while (/\p{Nd}/u.test(String.fromCodePoint(cp - 1))) {
      cp--;
      offset++;
    }
    return String(offset % 10);
  });
}

/** Folded content words of `text`, in any script (lexical.ts rules). */
function words(text: string): string[] {
  return (normalizeText(text).match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}_-]*/gu) ?? [])
    .flatMap(segmentWords)
    .map(foldTerm)
    .filter((w) => isSignificantLength(w, 3));
}

/** The options the assistant offered with a question: key → label words. */
function offeredOptions(assistantText: string): Map<string, string[]> {
  const options = new Map<string, string[]>();
  if (!QUESTION_RE.test(assistantText)) return options;
  for (const m of asciiDigits(assistantText).matchAll(OPTION_LINE_RE)) {
    const key = /^\d+$/.test(m[1]) ? String(Number(m[1])) : m[1].toLowerCase();
    options.set(key, words(m[2]));
  }
  return options.size >= MIN_OPTIONS ? options : new Map();
}

function pickedByKey(text: string, options: Map<string, string[]>): boolean {
  if (text.length > PICK_MAX_CHARS) return false;
  const letter = LONE_LETTER_RE.exec(text);
  if (letter) return options.has(letter[1].toLowerCase());
  const numbers = new Set((text.match(STANDALONE_NUMBER_RE) ?? []).map((n) => String(Number(n))));
  if (numbers.size !== 1) return false;
  return options.has([...numbers][0]);
}

/**
 * Does `text` name exactly one option — a word of its label that no other
 * option's label has, in any inflection (`hasWordForm`: Postgres ~
 * Postgresilla ~ Postgres로)?
 */
function pickedByName(text: string, options: Map<string, string[]>): boolean {
  if (text.length > NAME_PICK_MAX_CHARS || isQuestion(text)) return false;
  const reply = new Set(words(text));
  if (reply.size === 0) return false;
  let named = 0;
  for (const [key, label] of options) {
    const others = new Set([...options].filter(([k]) => k !== key).flatMap(([, l]) => l));
    const own = label.filter((w) => !others.has(w));
    if (own.some((w) => hasWordForm(reply, w))) named++;
  }
  return named === 1;
}

function pickedOption(userText: string, options: Map<string, string[]>): boolean {
  const text = asciiDigits(userText).trim();
  if (text.length === 0) return false;
  return pickedByKey(text, options) || pickedByName(text, options);
}

/**
 * The user turns (content) among the last `window` user turns that pick one
 * of the options the preceding assistant turn offered. Tool and injected
 * turns between the two are skipped.
 */
export function optionPicks(turns: ChoiceTurn[], window: number): string[] {
  const userIdx: number[] = [];
  turns.forEach((t, i) => {
    if (t.role === "user") userIdx.push(i);
  });
  const picks: string[] = [];
  for (const i of userIdx.slice(-window)) {
    let j = i - 1;
    while (j >= 0 && turns[j].role !== "assistant" && turns[j].role !== "user") j--;
    if (j < 0 || turns[j].role !== "assistant") continue;
    const options = offeredOptions(turns[j].content);
    if (options.size > 0 && pickedOption(turns[i].content, options)) picks.push(turns[i].content);
  }
  return picks;
}
