import type { ZodError } from "zod";

/**
 * One line an agent can act on.
 *
 * Zod 4's `error.message` is a JSON array of issue objects. That is what
 * `recall(k: 0)` and `load_memory({id: ""})` used to dump into the MCP
 * `isError` payload — not a stack, but not "k must be 1-20" either.
 * `archive_memory` / `edit_memory` already format `issues`; this is the
 * same shape with the path, so `k=100` names `k`.
 */
export function invalidToolArgs(tool: string, error: ZodError): string {
  const where = error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "args"}: ${i.message}`)
    .join("; ");
  return `invalid ${tool} args: ${where}`;
}
