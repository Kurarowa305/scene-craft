import { test } from "node:test";
import assert from "node:assert/strict";
import { chatFixture } from "./chat-fixture.js";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";

test("メイン実行中に別threadで相談し、開始文脈と原文を開き直せる", async () => {
  const f = await chatFixture();
  let thread = 0;
  f.setHook((method, p) => {
    if (method === "thread/start")
      return {
        thread: { id: `distinct-${++thread}` },
        model: p.model,
        modelProvider: "openai",
      };
    if (method === "thread/resume")
      return {
        thread: { id: p.threadId },
        model: p.model,
        modelProvider: "openai",
      };
  });
  try {
    await f.post(`/api/conversations/${f.chat.id}/records`, {
      body: "開始時の資料",
    });
    await f.send();
    const side = await f.post(`/api/conversations/${f.chat.id}/side-chats`, {
      selectedStateIds: [],
    });
    const request = await f.post(
      `/api/conversations/${side.conversationId}/messages`,
      { body: "光の調整方法を相談" },
    );
    await waitFor(
      async () =>
        (await f.read(`/api/conversations/${side.conversationId}/chat`))
          .requests[0]?.turnId,
    );
    const main = (await f.view()).requests[0];
    const view = await f.read(`/api/conversations/${side.conversationId}/chat`);
    assert.notEqual(view.session.threadId, main.threadId);
    assert.equal(main.phase, "running");
    assert.equal(view.requests[0].role, "consultation");
    assert.equal("history" in view.requests[0].contextSnapshot, false);
    assert.equal("mainMessages" in view.requests[0].contextSnapshot, false);
    await f.post(`/api/conversations/${f.chat.id}/records`, {
      body: "後からの資料",
    });
    assert.equal(
      (await f.read(`/api/conversations/${side.conversationId}/side-context`))
        .history.records.length,
      1,
    );
    assert.equal(
      (await f.read(`/api/works/${f.work.id}/conversations`)).length,
      1,
    );
    assert.equal(
      (await f.read(`/api/works/${f.work.id}/record-history`)).requests.length,
      1,
    );
    f.notify("turn/completed", {
      threadId: view.session.threadId,
      turn: {
        id: view.requests[0].turnId,
        status: "completed",
        items: [{ id: "answer", type: "agentMessage", text: "照明の操作方法" }],
      },
    });
    await f.restart();
    const reopened = await f.read(
      `/api/conversations/${side.conversationId}/chat`,
    );
    assert.equal(reopened.requests[0].id, request.id);
    assert.equal(reopened.requests[0].items[0].text, "照明の操作方法");
    assert.deepEqual(
      await f.read(`/api/conversations/${side.conversationId}/side-context`),
      side,
    );
    assert.equal(
      (await f.read(`/api/conversations/${f.chat.id}/side-chats`))[0]
        .conversationId,
      side.conversationId,
    );
  } finally {
    await f.close();
  }
});

async function waitFor(condition: () => Promise<unknown>) {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("timed out");
}

test("話題入力なしで作成し、最初のサイド原文から補助Codexで命名して再起動後も一覧に返す", async () => {
  const f = await chatFixture(true);
  try {
    await f.post("/api/auxiliary/model", { model: "fixture-a" });
    const side = await f.post(`/api/conversations/${f.chat.id}/side-chats`, {
      selectedStateIds: [],
    });
    assert.equal(side.topic, undefined);
    const listing = () => f.read(`/api/conversations/${f.chat.id}/side-chats`);
    assert.equal((await listing())[0].title, null);
    const before = await f.read(
      `/api/conversations/${side.conversationId}/chat`,
    );
    assert.equal(before.auxiliary.jobs.length, 0);
    const request = await f.post(
      `/api/conversations/${side.conversationId}/messages`,
      { body: "港のライトについて相談" },
    );
    await waitFor(async () => (await listing())[0].title === "港の光の検討");
    const view = await f.read(`/api/conversations/${side.conversationId}/chat`);
    const job = view.auxiliary.jobs.find((j: any) => j.kind === "name");
    assert.equal(job.model, "fixture-a");
    assert.equal(job.sources[0].body, "港のライトについて相談");
    assert.notEqual(job.threadId, view.session.threadId);
    assert.equal(job.sourceRequestId, request.id);
    await f.restart();
    assert.equal((await listing())[0].title, "港の光の検討");
  } finally {
    await f.close();
  }
});

test("サイド相談は更新・制作・shell迂回を拒否し、停止後の参照と別接続の参照を失効させる", async () => {
  const f = await chatFixture();
  try {
    const side = await f.post(`/api/conversations/${f.chat.id}/side-chats`, {
      selectedStateIds: [],
    });
    const r = await f.post(
      `/api/conversations/${side.conversationId}/messages`,
      { body: "制作意図を更新: 不許可の変更" },
    );
    await waitFor(async () => f.calls.some((c) => c.method === "turn/start"));
    const settings = f.calls.find((c) => c.method === "thread/start")!.params;
    const env = settings.config["mcp_servers.scene_craft.env"];
    assert.deepEqual(settings.config["mcp_servers.scene_craft.enabled_tools"], [
      "get_execution_context",
      "find_records",
      "read_records",
    ]);
    const context = JSON.parse(
      f.calls.find((c) => c.method === "turn/start")!.params.additionalContext[
        "scene-craft"
      ].value,
    );
    const call = (
      tool: string,
      args = {},
      credential = env.SCENE_CRAFT_RPC_CREDENTIAL,
    ) =>
      rpc(env.SCENE_CRAFT_RPC_SOCKET, credential, tool, {
        contextRef: context.contextRef,
        operationId: randomUUID(),
        ...args,
      });
    const reference = (await call("get_execution_context")).result;
    assert.equal(reference.readOnly, true);
    assert.equal("history" in reference.fixed, false);
    for (const tool of [
      "create_work_intent",
      "update_work_intent",
      "create_manual_record",
      "update_manual_record",
      "record_human_decision",
      "create_edit_candidate",
      "protect",
      "send_to_main",
      "shell",
    ]) {
      assert.equal(
        (await call(tool, { sourceRequestId: r.id })).error,
        "SIDE_CHAT_READ_ONLY",
      );
    }
    assert.equal(
      (await call("get_execution_context", {}, "wrong")).error,
      "INVALID_CONNECTION",
    );
    const record = await f.raw(
      `/api/conversations/${side.conversationId}/records`,
      { requestKey: randomUUID(), body: "記録は禁止" },
    );
    assert.equal(record.statusCode, 403);
    const role = await f.raw(
      `/api/conversations/${side.conversationId}/messages`,
      { requestKey: randomUUID(), body: "工程の偽装", role: "reference" },
    );
    assert.equal(role.statusCode, 403);
    assert.equal(
      (await f.read(`/api/works/${f.work.id}/context`)).work.intent,
      null,
    );
    await f.post(`/api/chat-requests/${r.id}/stop`);
    assert.equal((await call("read_records")).error, "STALE_CONTEXT");
    const stopped = (
      await f.read(`/api/conversations/${side.conversationId}/chat`)
    ).requests[0];
    f.notify("turn/completed", {
      turn: { id: stopped.turnId, status: "interrupted", items: [] },
    });
    await f.post(`/api/chat-requests/${r.id}/resume`);
    await waitFor(
      async () => f.calls.filter((c) => c.method === "turn/start").length === 2,
    );
    assert.equal((await call("get_execution_context")).error, "STALE_CONTEXT");
    const resumed = JSON.parse(
      f.calls.filter((c) => c.method === "turn/start").at(-1)!.params
        .additionalContext["scene-craft"].value,
    );
    const resumedCall = () =>
      call("get_execution_context", { contextRef: resumed.contextRef });
    assert.equal((await resumedCall()).result.readOnly, true);
    f.notify("connection/lost", {});
    assert.equal((await resumedCall()).error, "STALE_CONTEXT");
  } finally {
    await f.close();
  }
});

test("選択成果物と50件超の参照を固定し、同じ開始要求は一度だけ作成する", async () => {
  const f = await chatFixture(false, true);
  try {
    for (let i = 0; i < 51; i++)
      await f.post(`/api/conversations/${f.chat.id}/records`, {
        body: `資料${i}`,
      });
    const imported = await f.post(`/api/conversations/${f.chat.id}/imports`, {
      body: "選択成果物",
      application: "Photoshop",
      beforeStateId: null,
      files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
    });
    const input = {
      requestKey: randomUUID(),
      selectedStateIds: [imported.state.id],
    };
    const side = await f.post(
      `/api/conversations/${f.chat.id}/side-chats`,
      input,
    );
    assert.equal(side.history.records.length, 52);
    assert.equal(side.selectedStates[0].id, imported.state.id);
    assert.equal(
      side.selectedStates[0].files[0].sha256,
      imported.state.files[0].sha256,
    );
    assert.deepEqual(
      await f.post(`/api/conversations/${f.chat.id}/side-chats`, input),
      side,
    );
    const invalid = await f.raw(`/api/conversations/${f.chat.id}/side-chats`, {
      ...input,
      requestKey: randomUUID(),
      selectedStateIds: [randomUUID()],
    });
    assert.equal(invalid.statusCode, 403);
    const nested = await f.raw(
      `/api/conversations/${side.conversationId}/side-chats`,
      { ...input, requestKey: randomUUID() },
    );
    assert.equal(nested.statusCode, 403);
    const importAttempt = await f.raw(
      `/api/conversations/${side.conversationId}/imports`,
      {
        requestKey: randomUUID(),
        body: "禁止する取り込み",
        application: "Photoshop",
        beforeStateId: null,
        files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
      },
    );
    assert.equal(importAttempt.statusCode, 403);
  } finally {
    await f.close();
  }
});

function rpc(
  path: string,
  credential: string,
  tool: string,
  args: unknown,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.on("error", reject);
    socket.on("connect", () =>
      socket.write(JSON.stringify({ credential, tool, args }) + "\n"),
    );
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data;
      if (buffer.includes("\n")) {
        socket.end();
        resolve(JSON.parse(buffer.split("\n")[0]));
      }
    });
  });
}
