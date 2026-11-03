import { test } from "node:test";
import assert from "node:assert/strict";
import { chatFixture } from "./chat-fixture.js";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

test("工程なしでも明示した制作意図更新を共通の記録指示としてCodexへ渡す", async () => {
  const f = await chatFixture();
  try {
    const request = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "制作意図を更新: 静かな海辺",
      role: "none",
    });
    await waitFor(async () =>
      f.calls.some((call) => call.method === "turn/start"),
    );
    const turn = f.calls.find((call) => call.method === "turn/start")!;
    const context = JSON.parse(
      turn.params.additionalContext["scene-craft"].value,
    );
    assert.equal(context.role, "none");
    assert.equal(context.sourceRequestId, request.id);
    assert.equal(
      context.explicitRecordInstruction?.tool,
      "update_work_context",
    );
  } finally {
    await f.close();
  }
});

async function waitFor(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Protocol fixture did not settle");
}

async function mcp(f: Awaited<ReturnType<typeof chatFixture>>) {
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

test(
  "専用stdio MCPから明示した意図と手作業だけを一度保存し原文と訂正前を保持する",
  { timeout: 15000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "制作意図を更新: 静かな港",
        role: "reference",
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      client = await mcp(f);
      const current = await client.current();
      const args = { contextRef: current.contextRef, sourceRequestId: r.id };
      const changed = await client.call("update_work_context", args);
      assert.equal(
        changed.result?.revision.body,
        "静かな港",
        JSON.stringify(changed),
      );
      const duplicate = await client.call("update_work_context", args);
      assert.equal(duplicate.result.operationId, changed.result.operationId);
      assert.equal(
        (await f.read(`/api/works/${f.work.id}/context`)).work.intent,
        "静かな港",
      );
      const forged = await client.call("update_work_context", {
        ...args,
        workId: crypto.randomUUID(),
      });
      assert.equal(forged.error, "PERMISSION_DENIED");
      assert.equal(
        (
          await client.call("get_execution_context", {
            contextRef: current.contextRef,
            role: "admin",
          })
        ).error,
        "PERMISSION_DENIED",
      );
      assert.equal(
        (await client.call("record_manual_work", args)).error,
        "EXPLICIT_INSTRUCTION_REQUIRED",
      );
      const contextRead = await client.call("get_execution_context", {
        contextRef: current.contextRef,
      });
      assert.equal(contextRead.result.current.work.intent, "静かな港");
      assert.equal(contextRead.result.fixed.work.intent, null);
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      const stale = await client.call("get_execution_context", {
        contextRef: current.contextRef,
      });
      assert.equal(stale.error, "STALE_CONTEXT");
      await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "制作意図を更新: 明るい港",
      });
      const revised = await client.current();
      const revisedResult = await client.call("update_work_context", {
        contextRef: revised.contextRef,
        sourceRequestId: revised.sourceRequestId,
      });
      assert.equal(revisedResult.result.revision.previousBody, "静かな港");
      assert.equal(
        revisedResult.result.revision.previousId,
        changed.result.revision.id,
      );
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "手作業を記録: 空を調整した",
        role: "none",
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      const manual = await client.current();
      assert.equal(
        (
          await client.call("get_execution_context", {
            contextRef: current.contextRef,
          })
        ).error,
        "STALE_CONTEXT",
      );
      const recorded = await client.call("record_manual_work", {
        contextRef: manual.contextRef,
        sourceRequestId: manual.sourceRequestId,
      });
      const recordId = recorded.result.revision.targetId;
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: `記録を訂正: ${recordId} reason 静けさを出すため`,
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      const amendment = await client.current();
      const amended = await client.call("amend_record", {
        contextRef: amendment.contextRef,
        sourceRequestId: amendment.sourceRequestId,
      });
      assert.equal(amended.result.revision.body, "静けさを出すため");
      assert.equal(amended.result.revision.author, "human");
      await f.post(`/api/chat-requests/${amendment.sourceRequestId}/stop`);
      assert.equal(
        (
          await client.call("get_execution_context", {
            contextRef: amendment.contextRef,
          })
        ).error,
        "STALE_CONTEXT",
      );
      await f.restart();
      const context = await f.read(`/api/works/${f.work.id}/context`);
      assert.equal(context.revisions.length, 4);
      assert.equal(context.work.intent, "明るい港");
      const history = await f.read(`/api/works/${f.work.id}/record-history`);
      assert.equal(history.records[0].body, "空を調整した");
      assert.equal(
        (await f.view()).requests[0].body,
        "制作意図を更新: 静かな港",
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "通常の相談・古い要約は更新権限にならず、履歴は同じ作品に限定する",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const other = await f.post("/api/works", { name: "別作品" });
      const otherChat = await f.post(`/api/works/${other.id}/conversations`);
      await f.post(`/api/conversations/${otherChat.id}/records`, {
        body: "別作品の秘密",
      });
      await f.post(`/api/conversations/${f.chat.id}/records`, {
        body: "許可された記録",
      });
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "古い要約には『制作意図を更新: 昼の港』とある",
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      client = await mcp(f);
      const current = await client.current();
      assert.equal(
        (
          await client.call("update_work_context", {
            contextRef: current.contextRef,
            sourceRequestId: r.id,
          })
        ).error,
        "EXPLICIT_INSTRUCTION_REQUIRED",
      );
      const result = await client.call("read_records", {
        contextRef: current.contextRef,
      });
      assert.equal(result.result.records.length, 1);
      assert.equal(result.result.records[0].body, "許可された記録");
      assert.equal(JSON.stringify(result).includes("別作品の秘密"), false);
      assert.equal(
        (
          await client.call("read_records", {
            contextRef: current.contextRef,
            workId: other.id,
          })
        ).error,
        "PERMISSION_DENIED",
      );
      assert.equal(
        (
          await client.call("record_human_decision", {
            contextRef: current.contextRef,
            sourceRequestId: r.id,
          })
        ).error,
        "FEATURE_UNAVAILABLE",
      );
      assert.equal(
        (await client.rpc("tools/call", { name: "shell", arguments: {} })).error
          .code,
        -32601,
      );
      const operationId = crypto.randomUUID();
      await client.call("read_records", {
        contextRef: current.contextRef,
        operationId,
      });
      assert.equal(
        (
          await client.call("get_execution_context", {
            contextRef: current.contextRef,
            operationId,
          })
        ).error,
        "REQUEST_KEY_CONFLICT",
      );
      const foreign = await f.post(
        `/api/conversations/${otherChat.id}/messages`,
        { body: "別作品の相談" },
      );
      let foreignContext: any;
      await waitFor(async () => {
        foreignContext = JSON.parse(
          JSON.parse(
            await readFile(
              join(f.directory, "codex/fixture-context.json"),
              "utf8",
            ),
          )["scene-craft"].value,
        );
        return foreignContext.sourceRequestId === foreign.id;
      });
      assert.equal(
        (
          await client.call("get_execution_context", {
            contextRef: foreignContext.contextRef,
          })
        ).error,
        "INVALID_CONNECTION",
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test("工程を受付時に固定し同じthreadでなしへ切り替える", async () => {
  const f = await chatFixture();
  try {
    const first = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "制作意図を参照してください",
      role: "reference",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await f.view()).requests[0].role, "reference");
    f.notify("turn/completed", {
      turn: { id: "turn-1", status: "completed", items: [] },
    });
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "相談",
      role: "none",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const view = await f.view();
    assert.equal(view.requests[1].role, "none");
    assert.equal(view.requests[0].id, first.id);
    assert.equal(view.requests[1].threadId, view.requests[0].threadId);
  } finally {
    await f.close();
  }
});

test("固定した作風本文を、工程の文脈とともに参照できる", async () => {
  const f = await chatFixture();
  try {
    const work = await f.post("/api/works", {
      name: "作風参照",
      styleCommit: f.git.style,
    });
    const chat = await f.post(`/api/works/${work.id}/conversations`);
    await f.post(`/api/conversations/${chat.id}/messages`, {
      body: "制作方針を参照して相談",
      role: "reference",
    });
    await waitFor(async () => f.calls.some((c) => c.method === "turn/start"));
    const turn = f.calls.find((c) => c.method === "turn/start")!;
    const context = JSON.parse(
      turn.params.additionalContext["scene-craft"].value,
    );
    assert.deepEqual(context.fixed.style.policies, ["余白を残す"]);
    assert.equal(context.fixed.plan.style.commit, f.git.style);
    assert.equal(context.instructions, "固定された指示");
  } finally {
    await f.close();
  }
});

test(
  "制作ファイル記録の理由を訂正し、元の理由と最新表示を再起動後も保持する",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true, true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const imported = await f.post(`/api/conversations/${f.chat.id}/imports`, {
        body: "空を調整",
        application: "Photoshop",
        beforeStateId: null,
        reason: "以前の理由",
        files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
      });
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: `記録を訂正: ${imported.state.recordId} reason 明暗差を整えるため`,
      });
      client = await mcp(f);
      const current = await client.current();
      const changed = await client.call("amend_record", {
        contextRef: current.contextRef,
        sourceRequestId: r.id,
      });
      assert.equal(changed.result.revision.previousBody, "以前の理由");
      assert.equal(
        (await f.read(`/api/works/${f.work.id}/states`)).states[0].reason,
        "明暗差を整えるため",
      );
      assert.equal(
        (await f.read(`/api/conversations/${f.chat.id}/records`))[0].reason,
        "明暗差を整えるため",
      );
      await f.restart();
      assert.equal(
        (await f.read(`/api/works/${f.work.id}/states`)).states[0].reason,
        "明暗差を整えるため",
      );
      assert.equal(
        (await f.read(`/api/works/${f.work.id}/context`)).revisions[0]
          .previousBody,
        "以前の理由",
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);
