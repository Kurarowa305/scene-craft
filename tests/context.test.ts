import { mcp, waitFor } from "./mcp-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatFixture } from "./chat-fixture.js";
import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
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
    assert.equal(context.explicitRecordInstruction?.tool, "create_work_intent");
  } finally {
    await f.close();
  }
});

test(
  "自然文の解釈中に停止した依頼は保存せず、解釈用turnも中断する",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "解釈中の停止を検査する記録依頼",
      });
      client = await mcp(f);
      const current = await client.current();
      const pending = client.call("create_manual_record", {
        contextRef: current.contextRef,
        sourceRequestId: r.id,
      });
      await waitFor(async () => {
        try {
          await stat(
            join(f.directory, "codex/fixture-interpretation-started.json"),
          );
          return true;
        } catch {
          return false;
        }
      });
      await f.post(`/api/chat-requests/${r.id}/stop`);
      assert.equal((await pending).error, "STALE_CONTEXT");
      assert.equal(
        (await f.read(`/api/conversations/${f.chat.id}/records`)).length,
        0,
      );
      assert.equal(
        (await f.view()).requests[0].recordInterpretation,
        undefined,
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "自然文解釈が利用上限で失敗したら保存せず、元の依頼も停止する",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "解釈時の利用上限を検査する記録依頼",
      });
      client = await mcp(f);
      const current = await client.current();
      assert.equal(
        (
          await client.call("create_manual_record", {
            contextRef: current.contextRef,
            sourceRequestId: r.id,
          })
        ).error,
        "USAGE_LIMIT",
      );
      await waitFor(
        async () => (await f.view()).requests[0].phase === "blocked",
      );
      assert.equal((await f.view()).requests[0].error, "USAGE_LIMIT");
      assert.equal(
        (await f.read(`/api/conversations/${f.chat.id}/records`)).length,
        0,
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "旧解釈threadの遅い失敗で、停止後に再開した新しい試行を止めない",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "手作業で「Photoshopで空の色を調整した」を記録して",
      });
      client = await mcp(f);
      const current = await client.current();
      await writeFile(
        join(f.directory, "codex/hold-interpretation-start"),
        "hold",
      );
      const pending = client.call("create_manual_record", {
        contextRef: current.contextRef,
        sourceRequestId: r.id,
      });
      await waitFor(async () => {
        try {
          await stat(
            join(f.directory, "codex/fixture-interpretation-start-held"),
          );
          return true;
        } catch {
          return false;
        }
      });
      await f.post(`/api/chat-requests/${r.id}/stop`);
      await waitFor(async () => Boolean((await f.view()).requests[0].terminal));
      await f.post(`/api/chat-requests/${r.id}/resume`);
      await waitFor(
        async () =>
          (await f.view()).requests[0].retryCount === 1 &&
          Boolean((await f.view()).requests[0].turnId),
      );
      await pending;
      const latest = (await f.view()).requests[0];
      assert.equal(latest.retryCount, 1);
      assert.equal(latest.phase, "running");
      assert.equal(latest.error, null);
      assert.equal(latest.recordInterpretation, undefined);
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "制作意図へ一度だけ追記し、現在の全文と変更前後を保持する",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      let request = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "制作意図を更新: 静かな港",
      });
      client = await mcp(f);
      let current = await client.current();
      await client.call("create_work_intent", {
        contextRef: current.contextRef,
        sourceRequestId: request.id,
      });
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      request = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "制作意図に追記: 夕方の光を重視",
      });
      current = await client.current();
      const args = {
        contextRef: current.contextRef,
        sourceRequestId: request.id,
      };
      const added = await client.call("update_work_intent", args);
      assert.equal(
        added.result?.revision.body,
        "静かな港\n夕方の光を重視",
        JSON.stringify(added),
      );
      assert.equal(added.result.revision.previousBody, "静かな港");
      assert.equal(added.result.revision.mode, "append");
      assert.equal(added.result.revision.addedText, "夕方の光を重視");
      await client.call("update_work_intent", args);
      assert.equal(
        (await f.read(`/api/works/${f.work.id}/context`)).work.intent,
        "静かな港\n夕方の光を重視",
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "手作業の既存本文と理由を一つの文章として追記・全文変更し、旧文章を残す",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true, true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const imported = await f.post(`/api/conversations/${f.chat.id}/imports`, {
        body: "空の色を調整した",
        reason: "静けさを出すため",
        application: "Photoshop",
        beforeStateId: null,
        files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
      });
      let records = await f.read(`/api/conversations/${f.chat.id}/records`);
      assert.equal(records[0].body, "空の色を調整した\n静けさを出すため");
      let request = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: `記録に追記: ${imported.state.recordId} 照明も調整した。影を柔らかくするため。`,
      });
      client = await mcp(f);
      let current = await client.current();
      const args = {
        contextRef: current.contextRef,
        sourceRequestId: request.id,
      };
      const added = await client.call("update_manual_record", args);
      assert.equal(
        added.result.revision.body,
        "空の色を調整した\n静けさを出すため\n照明も調整した。影を柔らかくするため。",
      );
      assert.equal(
        added.result.revision.previousBody,
        "空の色を調整した\n静けさを出すため",
      );
      await client.call("update_manual_record", args);
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      request = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: `記録を訂正: ${imported.state.recordId} body 完成記録。明暗を整えた。`,
      });
      current = await client.current();
      await client.call("create_manual_record", {
        contextRef: current.contextRef,
        sourceRequestId: request.id,
      });
      await f.restart();
      records = await f.read(`/api/conversations/${f.chat.id}/records`);
      assert.equal(records[0].body, "完成記録。明暗を整えた。");
      assert.equal(records[0].reason, null);
      const revisions = (await f.read(`/api/works/${f.work.id}/context`))
        .revisions;
      assert.equal(
        revisions.at(-1).previousBody,
        "空の色を調整した\n静けさを出すため\n照明も調整した。影を柔らかくするため。",
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "CREATEで制作意図を設定し、UPDATEで既存内容の一部を編集する",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      let r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "制作意図を更新: 静かな港",
      });
      client = await mcp(f);
      let c = await client.current();
      const created = await client.call("create_work_intent", {
        contextRef: c.contextRef,
        sourceRequestId: r.id,
      });
      assert.equal(
        created.result?.revision.body,
        "静かな港",
        JSON.stringify(created),
      );
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "制作意図の「静かな」を「賑やかな」に変更して",
      });
      c = await client.current();
      const updated = await client.call("update_work_intent", {
        contextRef: c.contextRef,
        sourceRequestId: r.id,
      });
      assert.equal(
        updated.result?.revision.body,
        "賑やかな港",
        JSON.stringify(updated),
      );
      assert.equal(updated.result.revision.action, "update");
      assert.equal(updated.result.revision.previousBody, "静かな港");
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "自然な文章の手作業記録依頼を原文に結び付けて一度だけ保存する",
  { timeout: 15000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const request = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "手作業で「Photoshopで空の色を調整した」を記録して",
        role: "none",
      });
      client = await mcp(f);
      const current = await client.current();
      const result = await client.call("create_manual_record", {
        contextRef: current.contextRef,
        sourceRequestId: request.id,
      });
      assert.equal(
        result.result?.revision.body,
        "Photoshopで空の色を調整した",
        JSON.stringify(result),
      );
      assert.equal(result.result.revision.sourceRequestId, request.id);
      const records = await f.read(`/api/conversations/${f.chat.id}/records`);
      assert.equal(records.length, 1);
      assert.equal(records[0].body, "Photoshopで空の色を調整した");
      const again = await client.call("create_manual_record", {
        contextRef: current.contextRef,
        sourceRequestId: request.id,
      });
      assert.equal(again.result.revision.id, result.result.revision.id);
      assert.equal(
        (await f.read(`/api/conversations/${f.chat.id}/records`)).length,
        1,
      );
      const saved = (await f.view()).requests[0].recordInterpretation;
      assert.equal(saved.model, "fixture-a");
      assert.equal(saved.status, "update");
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "自然な制作意図更新と直前の記録への追記を保存し、元の文章を保持する",
  { timeout: 15000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const original = await f.post(`/api/conversations/${f.chat.id}/records`, {
        body: "空の色を調整した",
      });
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "制作意図を「夕暮れの港」に変えてください",
      });
      client = await mcp(f);
      const current = await client.current();
      assert.equal(
        (
          await client.call("create_work_intent", {
            contextRef: current.contextRef,
            sourceRequestId: r.id,
          })
        ).result.revision.body,
        "夕暮れの港",
      );
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      const intentAppend = await f.post(
        `/api/conversations/${f.chat.id}/messages`,
        { body: "制作意図に「夕方の光を重視」を追記して" },
      );
      const intentContext = await client.current();
      const appendedIntent = await client.call("update_work_intent", {
        contextRef: intentContext.contextRef,
        sourceRequestId: intentAppend.id,
      });
      assert.equal(
        appendedIntent.result.revision.body,
        "夕暮れの港\n夕方の光を重視",
      );
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      const amendment = await f.post(
        `/api/conversations/${f.chat.id}/messages`,
        { body: "直前の記録に「静けさを出すため」を追記して" },
      );
      const next = await client.current();
      const changed = await client.call("update_manual_record", {
        contextRef: next.contextRef,
        sourceRequestId: amendment.id,
      });
      assert.equal(changed.result.revision.targetId, original.id);
      assert.equal(
        changed.result.revision.body,
        "空の色を調整した\n静けさを出すため",
      );
      await f.restart();
      assert.equal(
        (await f.read(`/api/conversations/${f.chat.id}/records`))[0].body,
        "空の色を調整した\n静けさを出すため",
      );
      assert.equal(
        (await f.view()).requests[2].body,
        "直前の記録に「静けさを出すため」を追記して",
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

for (const message of [
  "「Photoshopで空の色を調整したことを記録して」と言われました",
  "Photoshopで空の色を調整した。記録しないでください",
  "Photoshopで空の色を調整したことはどう記録すればいい？",
])
  test(
    `引用・否定・相談から更新しない: ${message}`,
    { timeout: 10000 },
    async () => {
      const f = await chatFixture(true);
      let client: Awaited<ReturnType<typeof mcp>> | undefined;
      try {
        const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
          body: message,
        });
        client = await mcp(f);
        const current = await client.current();
        const reply = await client.call("create_manual_record", {
          contextRef: current.contextRef,
          sourceRequestId: r.id,
        });
        assert.equal(reply.error, "EXPLICIT_INSTRUCTION_REQUIRED");
        assert.equal(
          (await f.read(`/api/conversations/${f.chat.id}/records`)).length,
          0,
        );
      } finally {
        client?.close();
        await f.close();
      }
    },
  );

test(
  "曖昧な依頼は具体的な確認事項を返し、解釈が原文にない文章を生成したら保存しない",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "その記録をいい感じに直して",
      });
      client = await mcp(f);
      const current = await client.current();
      const reply = await client.call("update_manual_record", {
        contextRef: current.contextRef,
        sourceRequestId: r.id,
      });
      assert.equal(reply.result.complete, false);
      assert.equal(reply.result.needsClarification, true);
      assert.match(reply.result.question, /どの記録/);
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      const faulty = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "原文にない文章を返す故障を検査",
      });
      const next = await client.current();
      const refused = await client.call("create_manual_record", {
        contextRef: next.contextRef,
        sourceRequestId: faulty.id,
      });
      assert.equal(refused.error, "RECORD_INTERPRETATION_FAILED");
      assert.equal(
        (await f.read(`/api/conversations/${f.chat.id}/records`)).length,
        0,
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

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
      const changed = await client.call("create_work_intent", args);
      assert.equal(
        changed.result?.revision.body,
        "静かな港",
        JSON.stringify(changed),
      );
      const duplicate = await client.call("create_work_intent", args);
      assert.equal(duplicate.result.operationId, changed.result.operationId);
      assert.equal(
        (await f.read(`/api/works/${f.work.id}/context`)).work.intent,
        "静かな港",
      );
      const forged = await client.call("create_work_intent", {
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
        (await client.call("create_manual_record", args)).error,
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
      const revisedResult = await client.call("create_work_intent", {
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
      const recorded = await client.call("create_manual_record", {
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
      const amended = await client.call("update_manual_record", {
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
          await client.call("create_work_intent", {
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
        "INVALID_SCENE_PLAN_ARGUMENTS",
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
      const changed = await client.call("update_manual_record", {
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

test(
  "手作業のUPDATEで一部だけ編集し、CREATEで同じ記録の全文を置き換える",
  { timeout: 12000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const original = await f.post(`/api/conversations/${f.chat.id}/records`, {
        body: "空の色を調整した。静けさを出すため。",
      });
      let r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "直前の記録の「空」を「海」に変更して",
      });
      client = await mcp(f);
      let c = await client.current();
      const args = { contextRef: c.contextRef, sourceRequestId: r.id };
      assert.equal(
        (await client.call("create_manual_record", args)).error,
        "EXPLICIT_INSTRUCTION_REQUIRED",
      );
      const edited = await client.call("update_manual_record", args);
      assert.equal(
        edited.result?.revision.body,
        "海の色を調整した。静けさを出すため。",
        JSON.stringify(edited),
      );
      assert.equal(edited.result.revision.targetId, original.id);
      assert.equal(
        edited.result.revision.previousBody,
        "空の色を調整した。静けさを出すため。",
      );
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "直前の記録の全文を「空と照明を調整した。落ち着いた雰囲気にするため。」に変更して",
      });
      c = await client.current();
      const created = await client.call("create_manual_record", {
        contextRef: c.contextRef,
        sourceRequestId: r.id,
      });
      assert.equal(
        created.result?.revision.action,
        "create",
        JSON.stringify(created),
      );
      assert.equal(created.result.revision.targetId, original.id);
      await f.restart();
      const records = await f.read(`/api/conversations/${f.chat.id}/records`);
      assert.equal(records.length, 1);
      assert.equal(
        records[0].body,
        "空と照明を調整した。落ち着いた雰囲気にするため。",
      );
      assert.equal(
        records[0].originalBody,
        "空の色を調整した。静けさを出すため。",
      );
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "最新50件より前の手作業もID指定の自然文UPDATEで編集できる",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      const original = await f.post(`/api/conversations/${f.chat.id}/records`, {
        body: "空を調整した。落ち着かせるため。",
      });
      for (let i = 0; i < 50; i++)
        await f.post(`/api/conversations/${f.chat.id}/records`, {
          body: `後続の記録${i}`,
        });
      const request = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: `記録${original.id}の「空」を「海」に変更して`,
      });
      client = await mcp(f);
      const current = await client.current();
      const result = await client.call("update_manual_record", {
        contextRef: current.contextRef,
        sourceRequestId: request.id,
      });
      assert.equal(
        result.result?.revision.body,
        "海を調整した。落ち着かせるため。",
        JSON.stringify(result),
      );
      assert.equal(result.result.revision.targetId, original.id);
    } finally {
      client?.close();
      await f.close();
    }
  },
);

test(
  "MCPは現行12ツールだけを公開し、削除した互換ツール名を拒否する",
  { timeout: 10000 },
  async () => {
    const f = await chatFixture(true);
    let client: Awaited<ReturnType<typeof mcp>> | undefined;
    try {
      await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body: "相談",
      });
      client = await mcp(f);
      const listed = await client.rpc("tools/list");
      assert.deepEqual(
        listed.result.tools.map((tool: { name: string }) => tool.name).sort(),
        [
          "get_execution_context",
          "find_records",
          "read_records",
          "create_work_intent",
          "update_work_intent",
          "create_manual_record",
          "update_manual_record",
          "record_human_decision",
          "save_scene_plan",
          "fetch_reference_page",
          "save_reference",
          "select_reference",
        ].sort(),
      );
      for (const name of [
        "update_work_context",
        "record_manual_work",
        "amend_record",
      ]) {
        const reply = await client.rpc("tools/call", { name, arguments: {} });
        assert.equal(reply.error?.code, -32601, JSON.stringify(reply));
      }
    } finally {
      client?.close();
      await f.close();
    }
  },
);
