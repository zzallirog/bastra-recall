import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrivialPrompt } from "../src/prompt-lane.js";

// Claude Code delivers background-task results as a user turn wrapped in
// <task-notification>. Nobody typed it; recalling on it only injects noise
// (on one install 154 of 543 "prompts" in four days were these).
test("isTrivialPrompt gates harness task notifications — nobody typed them", () => {
  const note = "<task-notification>\n<task-id>b7bggcsa4</task-id>\n<summary>Monitor event: run 7 progress</summary>\n</task-notification>";
  assert.equal(isTrivialPrompt(note), true);
  assert.equal(isTrivialPrompt(`  ${note}`), true);
  assert.equal(isTrivialPrompt("why did <task-notification> fire twice?"), false);
});
