/**
 * update-check network: hanging partner + body cap.
 *
 * Revert-check: drop `timeout: FETCH_TIMEOUT_MS` (and the timeout handler) in
 * getLatestVersion → hanging-server test overruns 1.5s. Drop the
 * MAX_RELEASE_BODY_BYTES guard → oversized-body test returns a parsed release
 * instead of null (or OOMs on a larger payload).
 *
 * Runner: node --import tsx --import ./scripts/test-env.mjs --test packages/daemon/__tests__/update-check-network.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:http";
import {
  FETCH_TIMEOUT_MS,
  getLatestVersion,
  MAX_RELEASE_BODY_BYTES,
} from "../src/update-check.js";

function listen(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(handler);
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
        url: `http://127.0.0.1:${port}/releases/latest`,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

test("getLatestVersion: hanging partner returns null inside FETCH_TIMEOUT_MS", async () => {
  const hang = await listen(() => {
    /* never respond */
  });
  const t0 = Date.now();
  try {
    const r = await getLatestVersion(hang.url);
    assert.equal(r, null);
    const ms = Date.now() - t0;
    assert.ok(ms >= FETCH_TIMEOUT_MS - 200, `timeout did not wait (${ms}ms)`);
    assert.ok(ms < FETCH_TIMEOUT_MS + 1500, `timeout overran (${ms}ms)`);
  } finally {
    await hang.close();
  }
});

test("getLatestVersion: a body over MAX_RELEASE_BODY_BYTES is refused", async () => {
  const hang = await listen((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write(`{"tag_name":"v9.9.9","body":"`);
    const chunk = "x".repeat(64 * 1024);
    let sent = 0;
    const pump = (): void => {
      while (sent < MAX_RELEASE_BODY_BYTES + 32 * 1024) {
        if (!res.write(chunk)) {
          res.once("drain", pump);
          return;
        }
        sent += chunk.length;
      }
      res.end(`"}`);
    };
    pump();
  });
  try {
    const r = await getLatestVersion(hang.url);
    assert.equal(r, null, "an oversized release body must not parse as a release");
  } finally {
    await hang.close();
  }
});
