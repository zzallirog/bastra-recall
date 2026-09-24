/**
 * Tests for ALL_TOOL_DEFS — the single source of truth the daemon serves at
 * GET /tools and the forwarder falls back to (#132). The core guarantee: the
 * schema clients are told declares `body` as a required string for save_memory,
 * so a forwarder/daemon can never disagree about it.
 *
 * Runner: tsx --test __tests__/tool-defs.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_TOOL_DEFS,
  filterToolDefsForSurface,
  isToolAllowed,
  toolSurfaceDenial,
  toolSurfaceFrom,
} from "../src/tool-defs.js";

interface ToolDef {
  name: string;
  inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
}

function tool(name: string): ToolDef {
  const t = (ALL_TOOL_DEFS as ToolDef[]).find((d) => d.name === name);
  assert.ok(t, `ALL_TOOL_DEFS must contain ${name}`);
  return t;
}

test("ALL_TOOL_DEFS contains the core memory tools", () => {
  const names = (ALL_TOOL_DEFS as ToolDef[]).map((d) => d.name);
  for (const n of ["recall", "load_memory", "save_memory"]) {
    assert.ok(names.includes(n), `expected tool ${n}`);
  }
});

test("recall schema is query XOR queries, not required:[query]", () => {
  const recall = tool("recall");
  const schema = recall.inputSchema as {
    required?: string[];
    anyOf?: { required?: string[] }[];
    properties?: { k?: { minimum?: number; maximum?: number }; queries?: unknown };
  };
  assert.ok(
    !schema.required?.includes("query"),
    "required:[query] traps batch mode: clients that honor it send query+queries, then the handler rejects both",
  );
  assert.ok(!schema.required?.includes("queries"), "queries is not always required either");
  assert.equal(schema.properties?.k?.minimum, 1);
  assert.equal(schema.properties?.k?.maximum, 20);
  assert.ok(schema.properties?.queries, "queries is a first-class argument, not an undocumented extra");
});

test("find_document k range is in the schema, not only in the description", () => {
  const find = tool("find_document");
  const k = find.inputSchema.properties?.k as { minimum?: number; maximum?: number } | undefined;
  assert.equal(k?.minimum, 1);
  assert.equal(k?.maximum, 5);
});

test("recall description names no_home — the skill points agents there", () => {
  const recall = (ALL_TOOL_DEFS as { name: string; description?: string }[]).find((d) => d.name === "recall");
  assert.match(
    recall?.description ?? "",
    /no_home/,
    "skill says 'weak_result / no_home signals: recall tool description' — the description must actually name no_home",
  );
});

test("save_memory declares body as a required string (#132 guarantee)", () => {
  const save = tool("save_memory");
  assert.equal(save.inputSchema.properties?.body?.type, "string", "body must be a string property");
  assert.ok(
    save.inputSchema.required?.includes("body"),
    "body must be in the required list — this is exactly the field that arrived undefined in #132",
  );
});

test("save_memory declares valence + reflex params as optional (#217)", () => {
  const save = tool("save_memory");
  assert.equal(save.inputSchema.properties?.salience?.type, "number");
  assert.equal(save.inputSchema.properties?.emotion?.type, "string");
  assert.equal(save.inputSchema.properties?.recall_mode?.type, "string");
  for (const field of ["salience", "emotion", "recall_mode"]) {
    assert.ok(
      !save.inputSchema.required?.includes(field),
      `${field} must stay optional — valence is capture-rule-driven, never mandatory`,
    );
  }
});

test("every tool def has a name and an object inputSchema", () => {
  for (const d of ALL_TOOL_DEFS as ToolDef[]) {
    assert.equal(typeof d.name, "string");
    assert.ok(d.name.length > 0);
    assert.equal(typeof d.inputSchema, "object");
  }
});

test("tool names are unique (no accidental double-registration)", () => {
  const names = (ALL_TOOL_DEFS as ToolDef[]).map((d) => d.name);
  assert.equal(names.length, new Set(names).size, "duplicate tool name in ALL_TOOL_DEFS");
});

// ─── #481: the per-client tool surface ───────────────────────────────

const LIFECYCLE_TOOLS = ["archive_memory", "move_document", "recategorize_document"];

test("the search surface lists exactly the read tools", () => {
  const names = filterToolDefsForSurface(ALL_TOOL_DEFS as ToolDef[], "search").map((d) => d.name);
  assert.deepEqual(
    [...names].sort(),
    [
      "find_affected_files",
      "find_code",
      "find_document",
      "load_memory",
      "read_document",
      "recall",
    ],
    // #576: find_code reads a code index and writes nothing — it belongs with
    // the read tools, not behind the full surface.
    "search is read-only: recall, load_memory, find_document, read_document, " +
      "find_code, find_affected_files",
  );
  for (const t of [...LIFECYCLE_TOOLS, "save_memory"]) {
    assert.equal(isToolAllowed(t, "search"), false, `${t} must not be reachable on search`);
  }
});

test("the write surface adds the save tools and keeps lifecycle out", () => {
  const names = filterToolDefsForSurface(ALL_TOOL_DEFS as ToolDef[], "write").map((d) => d.name);
  assert.deepEqual(
    [...names].sort(),
    [
      "edit_memory",
      "find_affected_files",
      "find_code",
      "find_document",
      "load_memory",
      "read_document",
      "recall",
      "save_document",
      "save_memory",
      "save_product_doc",
    ],
    // #519: edit_memory joined the save tools. It changes one memory in place
    // and moves nothing, so it is not lifecycle — and leaving it out of the
    // surface a fresh install gets would push agents back to editing vault
    // files by hand, which is the hole it closes.
    "write is search + the save tools",
  );
  for (const t of LIFECYCLE_TOOLS) {
    assert.equal(isToolAllowed(t, "write"), false, `${t} is full-only — it reshapes the vault`);
  }
});

test("the full surface is today's behaviour: every tool, unfiltered", () => {
  const all = (ALL_TOOL_DEFS as ToolDef[]).map((d) => d.name).sort();
  const full = filterToolDefsForSurface(ALL_TOOL_DEFS as ToolDef[], "full")
    .map((d) => d.name)
    .sort();
  assert.deepEqual(full, all);
  for (const t of all) assert.equal(isToolAllowed(t, "full"), true);
});

test("an unset or unknown surface falls back to full (no silent narrowing)", () => {
  for (const raw of [undefined, "", "  ", "nonsense"]) {
    assert.equal(toolSurfaceFrom(raw), "full", `${JSON.stringify(raw)} must resolve to full`);
  }
  assert.equal(toolSurfaceFrom("Search"), "search");
  assert.equal(toolSurfaceFrom(" write "), "write");
});

test("the refusal names the surface and how to widen it", () => {
  const msg = toolSurfaceDenial("archive_memory", "write");
  assert.match(msg, /archive_memory/);
  assert.match(msg, /"write"/, "the agent must be able to name the active surface to the user");
  assert.match(msg, /BASTRA_TOOL_SURFACE/, "and how to widen it");
});

test("no tool schema carries a top-level combinator (anyOf/oneOf/allOf)", () => {
  // The Anthropic API rejects anyOf/oneOf/allOf at the top level of a tool
  // input_schema; one such tool fails the whole tool list a client sends.
  // Revert-check: put anyOf:[{required:["query"]},{required:["queries"]}]
  // back on recall → this test names recall.
  const bad = (ALL_TOOL_DEFS as ToolDef[])
    .filter((d) => ["anyOf", "oneOf", "allOf"].some((k) => k in (d.inputSchema as Record<string, unknown>)))
    .map((d) => d.name);
  assert.deepEqual(bad, []);
});
