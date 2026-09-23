// Lab #629: one line per node process, so coverage files can be folded back to the test that caused them.
// The test file is carried in LAB_TEST: environment survives non-node intermediates (npm exec -> sh -> node), a ppid chain does not.
import { appendFileSync } from "node:fs";
const dir = process.env.NODE_V8_COVERAGE;
if (dir) {
  // The runner's own argv lists EVERY test file; only a per-file test process names exactly one.
  const own = process.argv.filter((a) => /__tests__\/[^/]+\.test\.(ts|mjs)$/.test(a));
  if (own.length === 1 && !process.env.LAB_TEST) process.env.LAB_TEST = own[0];
  try {
    appendFileSync(`${dir}/procs.jsonl`, JSON.stringify({ pid: process.pid, ppid: process.ppid, test: process.env.LAB_TEST ?? null, argv: process.argv.slice(1, 4) }) + "\n");
  } catch {}
}
