/**
 * The stop lane reads an answered AskUserQuestion as a decision.
 *
 * The answer to Claude Code's AskUserQuestion comes back as a tool result, and
 * the prose heuristics skip tool results on purpose — so the most explicit
 * decision a user makes (a structured question, answered in place) never
 * suggested a save. On one owner's Arch transcripts: 55 answered questions,
 * 0 of them visible to the lane; the decision cue lists never fire for a user
 * whose decisions are "да, удалить как просил".
 *
 * Revert-check: drop `?? detectAnsweredQuestion(turns)` in
 * detectArchitectureDecision → the three "fires" tests are red.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/stop-lane-answered-question.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateHeuristics, parseTranscriptFile } from "../src/stop-lane.js";

function transcript(answer: { text: string; isError?: boolean }, userAsk = "почисти профили на вольте"): string {
  const rows = [
    { type: "user", message: { role: "user", content: userAsk } },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Перед удалением один вопрос." },
          { type: "tool_use", id: "toolu_1", name: "AskUserQuestion", input: { questions: [{ question: "Удалять ли zen-профиль?" }] } },
        ],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: answer.text, ...(answer.isError ? { is_error: true } : {}) }],
      },
    },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Удаляю." }] } },
  ];
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

const decision = (raw: string) =>
  evaluateHeuristics(parseTranscriptFile(raw)).find((s) => s.heuristic === "architecture-decision");

test("an answered AskUserQuestion fires the decision heuristic (Russian answer, current result shape)", () => {
  const s = decision(transcript({
    text: 'Your questions have been answered: "Удалять ли zen-профиль?"="Да, удалить как просил". You can now continue with these answers in mind.',
  }));
  assert.ok(s, "a decision suggestion");
  assert.match(s.body, /Да, удалить как просил/);
});

test("an answered AskUserQuestion fires in any language and the older result shape", () => {
  const s = decision(transcript({
    text: 'The user answered: "ゲームモードを切り替えますか？"="いいえ、設定だけ直す". Read the answers carefully.',
  }));
  assert.ok(s);
});

test("an image-only answer is still an answer", () => {
  assert.ok(decision(transcript({ text: 'The user answered: "Что покажет ls?"="(Image attached)".' })));
});

test("a denied or failed AskUserQuestion is not a decision", () => {
  assert.equal(decision(transcript({ text: "Hook PreToolUse:AskUserQuestion denied this tool call", isError: true })), undefined);
});

test("a plain tool result that quotes a pair elsewhere is not an answer", () => {
  const raw = [
    { type: "user", message: { role: "user", content: "проверь конфиг" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "cat x" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: '"key"="value"' }] } },
  ].map((r) => JSON.stringify(r)).join("\n");
  assert.equal(decision(raw), undefined);
});
