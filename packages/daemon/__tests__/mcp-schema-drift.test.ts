/**
 * MCP schema vs handler vs skill — the class this batch hunts.
 *
 * Revert-checks (each named on the assertion it would paint):
 *   - restore required:["query"] on recall → schema-XOR test red
 *   - throw parsed.error.message again in recall-handler → k=100 dumps JSON `[`
 *   - drop `no_home` from the recall description → skill-pointer test red
 *   - drop `find_code` from SKILL.md YAML Tools: → yaml-tools test red
 *
 * Runner: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/mcp-schema-drift.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Vault, SearchIndex } from "@bastra-recall/core";
import { Telemetry } from "../src/telemetry.js";
import { recallHandler, loadMemoryHandler, type ToolDeps } from "../src/tool-handlers.js";
import { parseFindDocumentArgs } from "../src/documents-handler.js";
import { ALL_TOOL_DEFS } from "../src/tool-defs.js";
import { invalidToolArgs } from "../src/invalid-args.js";
import { z } from "zod";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function tool(name: string): { name: string; description: string; inputSchema: Record<string, unknown> } {
  const t = (ALL_TOOL_DEFS as { name: string; description: string; inputSchema: Record<string, unknown> }[]).find(
    (d) => d.name === name,
  );
  assert.ok(t, `ALL_TOOL_DEFS must contain ${name}`);
  return t;
}

test("recall MCP schema allows queries without query (XOR, not required:[query])", () => {
  const schema = tool("recall").inputSchema as {
    required?: string[];
    anyOf?: { required?: string[] }[];
    properties?: { k?: { minimum?: number; maximum?: number } };
  };
  assert.ok(
    !schema.required?.includes("query"),
    "required:[query] is the trap: honor it and send both, handler rejects both",
  );
  assert.equal(schema.anyOf, undefined, "no top-level anyOf: the Anthropic API rejects it and drops the server's tools");
  assert.ok(!schema.required?.includes("queries"), "queries is not always required either");
  assert.equal(schema.properties?.k?.minimum, 1);
  assert.equal(schema.properties?.k?.maximum, 20);
});

test("recall tool description names no_home — skill points agents there", async () => {
  const skill = await readFile(join(REPO, "packages", "skill", "SKILL.md"), "utf8");
  assert.match(skill, /no_home/, "skill still names the signal");
  assert.match(
    tool("recall").description,
    /no_home/,
    "skill says the recall description covers no_home — dropping the word here is the drift",
  );
});

test("skill YAML Tools: list includes find_code, which the body teaches", async () => {
  const skill = await readFile(join(REPO, "packages", "skill", "SKILL.md"), "utf8");
  const fm = skill.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, "SKILL.md has frontmatter");
  assert.match(skill, /`find_code`/, "body teaches find_code");
  assert.match(
    fm[1]!,
    /find_code/,
    "YAML Tools: list is what clients use to load the skill — body-only is invisible",
  );
});

function assertReadable(label: string, message: string): void {
  assert.doesNotMatch(
    message.trim(),
    /^\[/,
    `${label}: dumped Zod JSON array, not a one-line invalid <tool> args: …`,
  );
  assert.match(message, /invalid \w+ args:/);
  assert.doesNotMatch(message, /at \S+\.ts:\d+/);
}

test("k=0, k=100, empty query, empty id are one-line errors, not Zod JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-schema-err-"));
  try {
    const vault = new Vault(dir);
    await vault.init();
    const search = new SearchIndex(vault);
    search.start();
    const deps = { vault, search, telemetry: new Telemetry(), vaultPath: dir } as ToolDeps;

    await assert.rejects(
      () => recallHandler(deps, { query: "hello", k: 0 }),
      (err: Error) => {
        assertReadable("k=0", err.message);
        assert.match(err.message, /\bk\b/);
        return true;
      },
    );
    await assert.rejects(
      () => recallHandler(deps, { query: "hello", k: 100 }),
      (err: Error) => {
        assertReadable("k=100", err.message);
        assert.match(err.message, /\bk\b/);
        return true;
      },
    );
    await assert.rejects(
      () => recallHandler(deps, { query: "" }),
      (err: Error) => {
        assertReadable("empty query", err.message);
        assert.match(err.message, /query/);
        return true;
      },
    );
    await assert.rejects(
      () => loadMemoryHandler(deps, { id: "" }),
      (err: Error) => {
        assertReadable("empty id", err.message);
        assert.match(err.message, /id/);
        return true;
      },
    );
    await assert.rejects(
      () => loadMemoryHandler(deps, { id: "does-not-exist" }),
      (err: Error) => {
        assert.match(err.message, /memory not found: does-not-exist/);
        assert.doesNotMatch(err.message, /at \S+\.ts:\d+/);
        return true;
      },
    );
    assert.throws(
      () => parseFindDocumentArgs({ query: "x", k: 0 }),
      (err: Error) => {
        assertReadable("find_document k=0", err.message);
        assert.match(err.message, /\bk\b/);
        return true;
      },
    );
    assert.throws(
      () => parseFindDocumentArgs({ query: "x", k: 100 }),
      (err: Error) => {
        assertReadable("find_document k=100", err.message);
        assert.match(err.message, /\bk\b/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("invalidToolArgs names the path — a JSON dump would not start with the tool", () => {
  const parsed = z.object({ k: z.number().int().min(1).max(20) }).safeParse({ k: 100 });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const msg = invalidToolArgs("recall", parsed.error);
  assert.match(msg, /^invalid recall args: k:/);
  assert.doesNotMatch(msg, /^\[/);
});
