/**
 * Tests für `bastra install claude-desktop --extension` (#218):
 *   - localMcpbPath / releaseDownloadUrl — deterministische Artefakt-Pfade
 *   - Flag-Parsing + Surface-Gate
 *
 * Runner: `tsx --test __tests__/extension-install.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:http";
import {
  localMcpbPath,
  releaseDownloadUrl,
  pkgVersion,
  parseSha256,
  latestMcpbAssetUrl,
} from "../src/cli/extension-install.js";
import { parseArgs } from "../src/cli/commands.js";

test("release asset URL and local path are version-locked and consistent", async () => {
  const version = await pkgVersion();
  assert.match(version, /^\d+\.\d+\.\d+/);
  assert.equal(
    releaseDownloadUrl(version),
    `https://github.com/n0mad-ai/bastra-recall/releases/download/v${version}/bastra-recall-${version}.mcpb`,
  );
  assert.match(localMcpbPath(version, "/tmp/pkg"), /^\/tmp\/pkg\/mcpb\/bastra-recall-.+\.mcpb$/);
});

test("parseSha256 accepts sha256sum output and bare digests, rejects everything else (#281)", () => {
  const hex = "a".repeat(64);
  assert.equal(parseSha256(`${hex}  bastra-recall-0.9.1.mcpb\n`), hex);
  assert.equal(parseSha256(hex), hex);
  assert.equal(parseSha256(`${"A".repeat(64)}  file`), hex, "uppercase digests normalize to lowercase");
  assert.equal(parseSha256(""), null);
  assert.equal(parseSha256("not a digest"), null);
  assert.equal(parseSha256(`${"a".repeat(63)}  short`), null, "63 hex chars is not a SHA-256");
  assert.equal(parseSha256(`<html>404 Not Found</html>`), null, "an error page never verifies");
});

function hangServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(() => {
    /* accept, never write */
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

test("latestMcpbAssetUrl: hanging GitHub returns null inside the deadline", async () => {
  const hang = await hangServer();
  const t0 = Date.now();
  try {
    const r = await latestMcpbAssetUrl({ apiUrl: hang.url, timeoutMs: 400 });
    assert.equal(r, null);
    const ms = Date.now() - t0;
    assert.ok(ms >= 300, `deadline did not wait (${ms}ms)`);
    assert.ok(ms < 1500, `deadline overran (${ms}ms) — fetch had no timeout`);
  } finally {
    await hang.close();
  }
});

test("--extension flag parses and stays scoped to the install command", () => {
  const args = parseArgs(["install", "claude-desktop", "--extension"]);
  assert.equal(args.command, "install");
  assert.equal(args.surface, "claude-desktop");
  assert.equal(args.extension, true);
  assert.equal(parseArgs(["install", "claude-desktop"]).extension, false);
});
