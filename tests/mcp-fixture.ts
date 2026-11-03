import assert from "node:assert/strict";
import { chatFixture } from "./chat-fixture.js";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
export async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Protocol fixture did not settle");
}

export async function mcp(f: Awaited<ReturnType<typeof chatFixture>>) {
  let credential = "";
  await waitFor(async () => {
    try {
      credential = JSON.parse(
        await readFile(join(f.directory, "codex/fixture-mcp.json"), "utf8"),
      ).SCENE_CRAFT_RPC_CREDENTIAL;
      return typeof credential === "string" && credential.length > 0;
    } catch {
      return false;
    }
  });
  const config = await readFile(join(f.directory, "codex/config.toml"), "utf8");
  const socketPath = JSON.parse(
    /^SCENE_CRAFT_RPC_SOCKET = (.+)$/m.exec(config)![1],
  );
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", resolve("src/server/mcp.ts")],
    {
      env: {
        ...process.env,
        SCENE_CRAFT_RPC_SOCKET: socketPath,
        SCENE_CRAFT_RPC_CREDENTIAL: credential,
      },
      stdio: "pipe",
    },
  );
  child.stderr.resume();
  let sequence = 0;
  const pending = new Map<number, (value: any) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const value = JSON.parse(line);
    pending.get(value.id)?.(value);
    pending.delete(value.id);
  });
  function rpc(method: string, params: unknown = {}) {
    const id = ++sequence;
    return new Promise<any>((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "contract-test", version: "1" },
  });
  return {
    rpc,
    async call(name: string, args: Record<string, unknown>) {
      const reply = await rpc("tools/call", {
        name,
        arguments: { operationId: crypto.randomUUID(), ...args },
      });
      return JSON.parse(reply.result.content[0].text);
    },
    async current() {
      let context: any;
      await waitFor(async () => {
        try {
          context = JSON.parse(
            JSON.parse(
              await readFile(
                join(f.directory, "codex/fixture-context.json"),
                "utf8",
              ),
            )["scene-craft"].value,
          );
        } catch {
          return false;
        }
        const latest = (await f.view()).requests.at(-1);
        return context.sourceRequestId === latest.id && Boolean(latest.turnId);
      });
      return context;
    },
    close: () => child.kill(),
  };
}
