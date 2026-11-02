import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";

async function launch(directory: string, port: number, extra: string[] = []) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("src/server/cli.ts"),
      "--data-dir",
      directory,
      "--port",
      String(port),
      ...extra,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const ready = new Promise<{ status: string; url: string }>(
    (resolveReady, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("startup timeout: " + errors));
      }, 10000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("\n")) {
          clearTimeout(timer);
          resolveReady(JSON.parse(output.split("\n")[0]));
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (!output.includes("\n"))
          reject(new Error(`exit ${code}: ${errors}`));
      });
    },
  );
  return { child, ready };
}

test("同一保存先を別ポートから二重起動しても正当な既存インスタンスを返す", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-start-"));
  const first = await launch(directory, 4417);
  try {
    assert.deepEqual(await first.ready, {
      status: "started",
      url: "http://localhost:4417",
    });
    const second = await launch(directory, 4418);
    assert.deepEqual(await second.ready, {
      status: "existing",
      url: "http://localhost:4417",
    });
    await new Promise<void>((resolveExit) =>
      second.child.once("exit", () => resolveExit()),
    );
    assert.equal(second.child.exitCode, 0);
  } finally {
    first.child.kill();
    await new Promise<void>((resolveExit) =>
      first.child.once("exit", () => resolveExit()),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("別アプリのポート占有を起動失敗として識別し、終了後は保存先を再利用できる", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-port-"));
  const foreign = createServer((_req, res) => res.end('{"app":"scene-craft"}'));
  await new Promise<void>((resolveListen) =>
    foreign.listen(4420, "127.0.0.1", resolveListen),
  );
  try {
    const blocked = await launch(directory, 4420);
    await assert.rejects(blocked.ready, /PORT_IN_USE/);
    await new Promise<void>((resolveClose) =>
      foreign.close(() => resolveClose()),
    );
    const retry = await launch(directory, 4420);
    assert.equal((await retry.ready).status, "started");
    retry.child.kill();
    await new Promise<void>((resolveExit) =>
      retry.child.once("exit", () => resolveExit()),
    );
  } finally {
    foreign.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("起動識別の秘密が一致しなければ既存扱いせず、クラッシュ後は排他を回復する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-proof-"));
  const first = await launch(directory, 4422);
  try {
    await first.ready;
    const descriptorPath = join(directory, "instance.json");
    const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
    await writeFile(
      descriptorPath,
      JSON.stringify({ ...descriptor, secret: "incorrect-secret" }),
    );
    const impostor = await launch(directory, 4423);
    await assert.rejects(impostor.ready, /OWNER_NOT_READY/);
    first.child.kill("SIGKILL");
    await new Promise<void>((resolveExit) =>
      first.child.once("exit", () => resolveExit()),
    );
    const recovered = await launch(directory, 4422);
    assert.deepEqual(await recovered.ready, {
      status: "started",
      url: "http://localhost:4422",
    });
    recovered.child.kill();
    await new Promise<void>((resolveExit) =>
      recovered.child.once("exit", () => resolveExit()),
    );
  } finally {
    if (first.child.exitCode === null && first.child.signalCode === null) {
      first.child.kill();
      await new Promise<void>((resolveExit) =>
        first.child.once("exit", () => resolveExit()),
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows PowerShell形式のUTF-8 BOM付き保存ルート設定でも起動する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-bom-"));
  const config = join(directory, "roots.json");
  await writeFile(
    config,
    "\uFEFF" +
      JSON.stringify({
        sources: [{ id: "source", path: directory }],
        managed: { id: "production", path: join(directory, "files") },
      }),
  );
  const instance = await launch(directory, 4428, ["--file-roots", config]);
  try {
    assert.equal((await instance.ready).status, "started");
    const result = await fetch("http://localhost:4428/api/file-roots");
    assert.deepEqual(await result.json(), {
      sources: [{ id: "source" }],
      configured: true,
    });
  } finally {
    instance.child.kill();
    await new Promise<void>((resolveExit) =>
      instance.child.once("exit", () => resolveExit()),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
