/**
 * UserPromptSubmit lane — prompt classification (split out of prompt-lane.ts,
 * #680): mode detection (retrieval / assertion), the trivial-prompt gate, the
 * per-mode score floor and prompt extraction from the hook payload. Pure and
 * deterministic; runs before any recall work.
 */
import { isQuestion, isSignificantLength } from "@bastra-recall/core";

export const SCORE_FLOOR = 50; // higher than PreToolUse: prompts rarely match recall_when exactly
export const MUST_LOAD_SCORE = 100;

export interface ClaudeHookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  /** primary surface in Claude Code docs */
  prompt?: string;
  /** legacy / alternative key seen in some Claude-Code payload variants */
  user_message?: string;
}

export type DetectedMode = "retrieval" | "assertion" | "none" | "generic";

// Retrieval mode (#33) used to be a DE/EN/RU word list at the start of the
// prompt ("find", "wo ist", "где лежит"): a Polish, Japanese or Arabic user
// asking the same thing never got it, so their lookups ran on the generic
// floor. The mode now follows the SHAPE of the prompt, which every script
// writes the same way: a question. A clause ending in a question mark of any
// script — ? ？ ؟ ; (Greek) ፧ ՞ ‽, or opened by the Spanish ¿ — is an
// explicit ask; an imperative lookup ("find the lease") without one is
// score-gated like any prompt (#677), in every language alike.
export function detectRetrieval(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return false;
  return isQuestion(trimmed);
}

// ─── assertion lane (#252) ───────────────────────────────────────────────────
//
// The PreToolUse lane is bound to a tool, so it reaches an agent that EDITS.
// Writing a sentence touches nothing: a draft reply, a changelog entry, an
// issue comment or an answer about project state makes factual claims and
// fires no hook — the claim comes out of model memory while the vault holds
// the measured answer.
//
// The request used to be classified by DE/EN/RU composing verbs and artefact
// nouns ("draft … release notes", "напиши … в ишью"); other languages never
// reached the mode. What stays is the language-neutral part of that signal:
// the prompt names an issue or pull request by number (`#123`) — outward by
// construction. A question about project state is a question (retrieval
// above); a composing request in any language is score-gated like the rest.

/** An issue/PR reference: `#123`, not a hex colour, heading or anchor. */
const ISSUE_REF_RE = /(?<![\p{L}\p{N}_&#/])#\d{1,6}(?![\p{L}\p{N}_])/u;

/**
 * #252: does the prompt ask for an ASSERTION — text that leaves this machine?
 * Structural only: it names an issue or pull request.
 */
export function detectAssertion(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return false;
  return ISSUE_REF_RE.test(trimmed);
}

// #151: trivial-prompt gate. Bare acks, one-worders and slash-command
// invocations cannot act on recalled context — injecting there is pure
// context tax (and in the default mode "all" the hook otherwise fires on
// EVERY prompt). Deterministic, runs before any recall work.
//
// No ack list (#707 had en/de): the gate is structural and holds in every
// script — at most two letters ("ok", "да", "ja"), a run of Hiragana only
// ("はい", "うん" — grammar, lexical.ts), or no letter or digit at all ("👍",
// "!!", "…"). Every other ack ("thanks", "спасибо", "tamam", "好的") runs one
// ordinary recall, gated by score like any prompt — a missed ack costs one
// lookup, never a lost recall.
const HIRAGANA_ONLY_RE = /^\p{Script=Hiragana}+$/u;

// A typed slash command: "/name" or "/name args". The first token must not
// contain a second "/" so absolute paths ("/Users/… bitte lesen") never gate.
const SLASH_COMMAND_RE = /^\/[a-z0-9][a-z0-9_-]*(?:\s|$)/i;

export function isTrivialPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return true;
  // Slash-command invocations — typed directly, or already expanded by
  // Claude Code into <command-name>/<local-command-*> blocks. The retrieval
  // regex would otherwise match phrases inside the expanded command/skill
  // body instead of user intent.
  if (SLASH_COMMAND_RE.test(trimmed) && !trimmed.includes("\n")) return true;
  if (trimmed.includes("<command-name>") || trimmed.startsWith("<local-command-")) return true;
  // Trailing punctuation of any script tolerated ("OK!", "да.", "はい。").
  const bare = trimmed.replace(/[\s\p{P}]+$/u, "");
  // Nothing to recall on in any language — emoji, punctuation, symbols.
  if (!/[\p{L}\p{N}]/u.test(bare)) return true;
  if (HIRAGANA_ONLY_RE.test(bare)) return true;
  // Two letters, counted as letters (a two-character Chinese or Korean word
  // is content: `isSignificantLength` counts it like a Latin word of four).
  return !/\s/.test(bare) && !isSignificantLength(bare, 3);
}

/**
 * Score floor per detected mode. "generic" floors at MUST_LOAD_SCORE — only
 * very strong matches may interrupt arbitrary prompts. #161 corollary: every
 * hit surviving the generic floor sits in the REQUIRED band, so the
 * hasRequired bypass in decideBackoff makes suppression impossible there by
 * construction (asserted in prompt-lane.test.ts instead of special-casing).
 */
export function effectiveScoreFloor(mode: DetectedMode): number {
  return mode === "generic" ? MUST_LOAD_SCORE : SCORE_FLOOR;
}

export function extractPrompt(payload: ClaudeHookPayload): string | null {
  const raw =
    typeof payload.prompt === "string"
      ? payload.prompt
      : typeof payload.user_message === "string"
        ? payload.user_message
        : null;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
