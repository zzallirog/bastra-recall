/**
 * The intent gate for the prompt lane's change-impact block (#606).
 *
 * WHY A GATE AT ALL. The Write/Edit block has a natural trigger: a file is
 * about to be written. A prompt has none, and "inject the graph on every
 * prompt" is the failure the counter-review named first — context cost on
 * every turn for an answer almost no turn asked for. So the block is delivered
 * only when the prompt asks a question about something the graph knows.
 *
 * TWO CONDITIONS, BOTH REQUIRED. The prompt is a QUESTION — in any script
 * (core `isQuestion`: ? ？ ؟ …) — AND it names a concrete target, a file or a
 * code-shaped symbol. Either alone is not enough: "was bricht das?" without a
 * name has nothing to look up, and "packages/core/src/save.ts" in a request
 * to reformat it is not a question at all.
 *
 * THE SECOND GATE IS THE GRAPH, NOT THIS FILE. Nothing here decides whether a
 * candidate is real; the caller resolves every candidate against the graph and
 * injects nothing when none resolves. That is what keeps the extraction below
 * able to be generous without the gate being loose: an ordinary word that
 * happens to look like an identifier is simply not in `idsByLabel`, and a path
 * that is not indexed is not in `symbolsByFile`.
 *
 * NO PHRASE LIST. This gate used to be German and English phrasings ("was
 * bricht", "who calls", "blast radius"); the same question in any other
 * language never got the graph's answer. The price of reading the shape
 * instead of the words: a question that names a symbol for another reason
 * ("what does `validateMemory` return?") also gets the callers — on a lane the
 * user opted into (#607), and only for a symbol the graph resolves.
 */
import { isQuestion } from "@bastra-recall/core";

/** Source extensions a path candidate must carry to be one. */
const SOURCE_EXT =
  "ts|tsx|mts|cts|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|scala|sh|sql|vue|svelte";

const PATH_RE = new RegExp(String.raw`(?:^|[\s\`'"(\[,])([\w.@/-]*[\w-]\.(?:${SOURCE_EXT}))\b`, "gi");

/** Anything the user set in backticks — they marked it as code themselves. */
const BACKTICKED_RE = /`([^`\n]{2,80})`/g;

/**
 * A bare identifier worth looking up: long enough not to be an article, and
 * shaped like code rather than like prose — an internal capital (camelCase,
 * PascalCase past the first letter) or an underscore. A lowercase word of any
 * language cannot match, which is what keeps the resolver from being handed
 * the whole sentence.
 */
const IDENTIFIER_RE = /\b([A-Za-z_$][A-Za-z0-9_$]{3,})\b/g;

function looksLikeCode(token: string): boolean {
  if (token.includes("_") || token.includes("$")) return true;
  return /[a-z][A-Z]/.test(token) || /^[A-Z][a-z0-9]+[A-Z]/.test(token);
}

export interface ImpactIntent {
  /** The prompt is a question (any script). */
  asked: boolean;
  /** Repo-relative or bare file paths the prompt names, in order of appearance. */
  paths: string[];
  /** Symbol candidates the prompt names, in order of appearance. */
  symbols: string[];
}

/** Nothing is looked at past this — a pasted stack trace is not a question. */
const MAX_PROMPT_CHARS = 4000;

/**
 * Read a prompt as a change-impact question.
 *
 * `asked` alone never injects anything: the caller must also resolve one of
 * `paths` or `symbols` against the graph. Both lists are capped, because the
 * cost of resolving them is paid inside the prompt lane's budget.
 */
export function changeImpactIntent(prompt: string): ImpactIntent {
  const text = prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;
  const asked = isQuestion(text);
  if (!asked) return { asked: false, paths: [], symbols: [] };

  const paths = take(matches(text, PATH_RE), 4);
  const symbols: string[] = [];
  for (const raw of matches(text, BACKTICKED_RE)) {
    const token = raw.replace(/\(\)$/, "").trim();
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token) && token.length >= 2) symbols.push(token);
  }
  for (const token of matches(text, IDENTIFIER_RE)) {
    if (looksLikeCode(token)) symbols.push(token);
  }
  return { asked: true, paths, symbols: take(symbols, 8) };
}

function matches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  // Cloned per call: a module-level /g regex carries `lastIndex` between calls.
  const local = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = local.exec(text)) !== null) {
    const value = (m[1] ?? "").trim();
    if (value.length > 0) out.push(value);
  }
  return out;
}

function take(values: readonly string[], n: number): string[] {
  return [...new Set(values)].slice(0, n);
}
