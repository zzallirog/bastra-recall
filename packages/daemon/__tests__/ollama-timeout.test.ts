/**
 * Ollama HTTP probes: connect+read deadline with a ref'd timer.
 *
 * Revert-check: restore AbortSignal.timeout in fetchWithDeadline → this
 * never-settling fetch test is cancelledByParent (duration ~2ms, no AbortError).
 * Strip the timeout from ollamaModelPulled → hanging-server test overruns 1.5s.
 *
 * Runner: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/ollama-timeout.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:http";
import { fetchWithDeadline, ollamaModelPulled } from "../src/cli/ollama.js";

function hangServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(() => {
    /* accept, never write a response */
  });
  const sockets = new Set<Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      ok({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

test("ollamaModelPulled: hanging partner returns null inside the deadline", async () => {
  const hang = await hangServer();
  const prev = process.env.BASTRA_OLLAMA_URL;
  process.env.BASTRA_OLLAMA_URL = hang.url;
  const t0 = Date.now();
  try {
    const r = await ollamaModelPulled("embeddinggemma", { timeoutMs: 400 });
    assert.equal(r, null);
    const ms = Date.now() - t0;
    assert.ok(ms >= 300, `deadline did not wait (${ms}ms)`);
    assert.ok(ms < 1500, `deadline overran (${ms}ms)`);
  } finally {
    if (prev === undefined) delete process.env.BASTRA_OLLAMA_URL;
    else process.env.BASTRA_OLLAMA_URL = prev;
    await hang.close();
  }
});

test("fetchWithDeadline: a never-settling fetch still aborts (ref timer, not AbortSignal.timeout)", async () => {
  // The fetch ignores the network and only rejects when OUR signal aborts.
  // AbortSignal.timeout is unref'd, so that abort never fires and node:test
  // cancels the case; a ref'd setTimeout keeps the loop alive until it does.
  const hanging: typeof fetch = (_url, init) =>
    new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(new DOMException("This operation was aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });
  const t0 = Date.now();
  await assert.rejects(
    () => fetchWithDeadline("http://127.0.0.1:1/", {}, 250, hanging),
    (err: Error) => err.name === "AbortError" || /abort/i.test(err.message),
  );
  const ms = Date.now() - t0;
  assert.ok(ms >= 200, `ref timer did not wait (${ms}ms)`);
  assert.ok(ms < 1200, `ref timer overran or was cancelledByParent (${ms}ms)`);
});
