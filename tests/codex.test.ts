import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connectCodex } from "../src/server/codex.js";
test(
  "起動失敗とシグナル終了のCodexを閉じても再接続・終了をハングさせない",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-exit-"));
    try {
      await assert.rejects(
        connectCodex("/no-such-scene-craft-codex", directory),
      );
      const fixture = resolve("tests/fixtures/codex.mjs");
      await chmod(fixture, 0o700);
      const c = await connectCodex(fixture, directory);
      await assert.rejects(c.rpc("test/exit", {}));
      assert.equal(c.available, false);
      await c.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
