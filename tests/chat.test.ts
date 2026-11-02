import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { gitFixture, cleanGitFixture } from "./git-fixture.js";
import { chatFixture } from "./chat-fixture.js";

test("Codex会話を公開操作で開始し、同じ受付は一度だけ実行して原文と終端を開き直す", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-chat-"));
  const git = await gitFixture(directory);
  let starts = 0;
  let notify: (method: string, params: any) => void = () => {};
  const codex = {
    onEvent(fn: typeof notify) {
      notify = fn;
      return () => {};
    },
    async rpc(method: string, params: any): Promise<any> {
      if (method === "account/read") return { account: { type: "chatgpt" } };
      if (method === "model/list")
        return {
          data: [
            {
              id: "test",
              model: "test",
              displayName: "Test",
              isDefault: true,
              defaultReasoningEffort: "low",
              supportedReasoningEfforts: [{ reasoningEffort: "low" }],
            },
          ],
          nextCursor: null,
        };
      if (method === "thread/start" || method === "thread/resume")
        return {
          thread: { id: "thread-1" },
          model: "test",
          modelProvider: "openai",
        };
      if (method === "turn/start") {
        starts++;
        return {
          turn: { id: `turn-${starts}`, status: "inProgress", items: [] },
        };
      }
      return {};
    },
    runtime: "fixture-1",
    async close() {},
  };
  let app = await createApp({
    directory,
    port: 4317,
    gitRepository: git.repository,
    codex,
  });
  try {
    const login = async () => {
      const s = await app.inject({
        url: "/api/session",
        headers: { host: "localhost:4317" },
      });
      return {
        host: "localhost:4317",
        origin: "http://localhost:4317",
        cookie: s.headers["set-cookie"]!.toString().split(";")[0],
        "x-csrf-token": s.json().csrfToken,
      };
    };
    let headers = await login();
    const post = async (url: string, payload: any) => {
      const r = await app.inject({ method: "POST", url, headers, payload });
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    await post("/api/versions/default", {
      requestKey: "definition-1",
      commit: git.definition,
    });
    const w = await post("/api/works", { requestKey: "work-0001", name: "港" });
    const c = await post(`/api/works/${w.id}/conversations`, {
      requestKey: "chat-0001",
    });
    await post(`/api/conversations/${c.id}/model`, {
      requestKey: "model-001",
      model: "test",
      effort: "low",
      speed: "standard",
    });
    const input = { requestKey: "send-0001", body: "  港の話\n" };
    const r = await post(`/api/conversations/${c.id}/messages`, input);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await post(`/api/conversations/${c.id}/messages`, input);
    assert.equal(again.id, r.id);
    assert.equal(starts, 1);
    notify("item/agentMessage/delta", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "a",
      delta: "こんにちは",
    });
    notify("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { id: "a", type: "agentMessage", text: "こんにちは" },
    });
    notify("turn/completed", {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "completed", items: [] },
    });
    let view = (
      await app.inject({ url: `/api/conversations/${c.id}/chat`, headers })
    ).json();
    assert.equal(view.requests[0].phase, "completed");
    assert.equal(view.requests[0].body, input.body);
    assert.equal(view.requests[0].items[0].text, "こんにちは");
    await app.close();
    app = await createApp({
      directory,
      port: 4317,
      gitRepository: git.repository,
      codex,
    });
    headers = await login();
    view = (
      await app.inject({ url: `/api/conversations/${c.id}/chat`, headers })
    ).json();
    assert.equal(view.session.threadId, "thread-1");
    assert.equal(view.requests[0].terminal, "completed");
    assert.equal(view.requests[0].selection.model, "test");
    assert.equal(view.requests[0].runtime, "fixture-1");
  } finally {
    await app.close();
    await cleanGitFixture(directory);
  }
});

test("新規会話は直前の選択を継承し、実行中の設定と同じthreadを維持する", async () => {
  const f = await chatFixture();
  try {
    const r = await f.send();
    await f.post(`/api/conversations/${f.chat.id}/model`, {
      model: "b",
      effort: "high",
      speed: "fast",
    });
    const second = await f.post(`/api/works/${f.work.id}/conversations`);
    assert.deepEqual(
      (await f.read(`/api/conversations/${second.id}/chat`)).session.selection,
      { model: "b", effort: "high", speed: "fast" },
    );
    assert.equal((await f.view()).requests[0].selection.model, "a");
    f.notify("turn/completed", {
      turn: { id: "turn-1", status: "completed", items: [] },
    });
    await f.send();
    assert.equal(f.calls.filter((c) => c.method === "thread/start").length, 1);
    assert.equal(f.calls.filter((c) => c.method === "thread/resume").length, 1);
    assert.equal(
      f.calls.filter((c) => c.method === "turn/start")[1].params.model,
      "b",
    );
  } finally {
    await f.close();
  }
});

test("停止を先に保存し、停止中の新規送信を拒否してinterruptし、再開時にも原文と予算を保持する", async () => {
  const f = await chatFixture();
  try {
    const r = await f.send();
    f.notify("item/agentMessage/delta", {
      turnId: "turn-1",
      itemId: "partial",
      delta: "途中",
    });
    await f.post(`/api/chat-requests/${r.id}/stop`);
    assert.equal((await f.view()).requests[0].stopRequested, true);
    assert.equal(
      (
        await f.raw(`/api/conversations/${f.chat.id}/messages`, {
          requestKey: "blocked-send",
          body: "新規",
        })
      ).statusCode,
      409,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(f.calls.some((c) => c.method === "turn/interrupt"));
    f.notify("turn/completed", {
      turn: { id: "turn-1", status: "interrupted", items: [] },
    });
    await f.post(`/api/chat-requests/${r.id}/resume`);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const value = (await f.view()).requests[0];
    assert.equal(value.retryCount, 1);
    assert.equal(value.attempts[0].items[0].text, "途中");
    assert.equal(value.body, "保持する原文");
  } finally {
    await f.close();
  }
});

for (const [info, reason] of [
  ["usageLimitExceeded", "USAGE_LIMIT"],
  ["unauthorized", "AUTH_REQUIRED"],
  ["modelNotFound", "MODEL_UNAVAILABLE"],
])
  test(`${info}は保存して停止し、自動再依頼しない`, async () => {
    const f = await chatFixture();
    try {
      await f.send();
      f.notify("error", {
        turnId: "turn-1",
        willRetry: true,
        error: { codexErrorInfo: info },
      });
      f.notify("turn/completed", {
        turn: {
          id: "turn-1",
          status: "failed",
          items: [],
          error: { codexErrorInfo: info },
        },
      });
      assert.equal((await f.view()).requests[0].error, reason);
      assert.equal((await f.view()).requests[0].phase, "blocked");
      assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
    } finally {
      await f.close();
    }
  });

test("内部通信再送中は終端を待ち、別モデルへのrerouteは停止して成功にしない", async () => {
  const f = await chatFixture();
  try {
    await f.send();
    f.notify("error", {
      turnId: "turn-1",
      willRetry: true,
      error: { codexErrorInfo: "other" },
    });
    assert.equal((await f.view()).requests[0].phase, "running");
    assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
    f.notify("model/rerouted", {
      turnId: "turn-1",
      fromModel: "a",
      toModel: "b",
      reason: "unavailable",
    });
    f.notify("turn/completed", {
      turn: { id: "turn-1", status: "completed", items: [] },
    });
    const r = (await f.view()).requests[0];
    assert.equal(r.phase, "blocked");
    assert.equal(r.actualModel, "b");
    assert.equal(r.error, "MODEL_REROUTED");
  } finally {
    await f.close();
  }
});

test("受付応答喪失は再送せず、本文一致だけで受付成功と断定しない", async () => {
  const f = await chatFixture();
  try {
    f.setHook((method) => {
      if (method === "turn/start") throw new Error("lost");
      if (method === "thread/turns/list")
        return {
          data: [
            {
              id: "other",
              status: "completed",
              items: [
                {
                  id: "u",
                  type: "userMessage",
                  content: [{ type: "text", text: "保持する原文" }],
                },
              ],
            },
          ],
          nextCursor: null,
        };
    });
    const r = await f.send();
    assert.equal((await f.view()).requests[0].phase, "unknown");
    await f.post(`/api/chat-requests/${r.id}/reconcile`);
    assert.equal((await f.view()).requests[0].error, "ACCEPTANCE_UNKNOWN");
    assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
  } finally {
    await f.close();
  }
});

test("再起動で自動実行せず、turnとitemの全ページを照合して欠落を回復する", async () => {
  const f = await chatFixture();
  try {
    const r = await f.send();
    await f.restart();
    assert.equal((await f.view()).requests[0].phase, "unknown");
    f.setHook((method, p) => {
      if (method === "thread/turns/list")
        return p.cursor
          ? {
              data: [{ id: "turn-1", status: "completed", items: [] }],
              nextCursor: null,
            }
          : {
              data: [{ id: "older", status: "completed", items: [] }],
              nextCursor: "turn-next",
            };
      if (method === "thread/items/list")
        return p.cursor
          ? {
              data: [
                {
                  turnId: "turn-1",
                  item: {
                    id: "a",
                    type: "agentMessage",
                    text: "保存された本文",
                  },
                },
              ],
              nextCursor: null,
            }
          : {
              data: [
                {
                  turnId: "turn-1",
                  item: {
                    id: "u",
                    type: "userMessage",
                    content: [{ type: "text", text: "保持する原文" }],
                  },
                },
              ],
              nextCursor: "item-next",
            };
    });
    await f.post(`/api/chat-requests/${r.id}/reconcile`);
    const v = (await f.view()).requests[0];
    assert.equal(v.phase, "completed");
    assert.equal(v.items.length, 2);
    assert.equal(v.items[1].text, "保存された本文");
    assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 1);
  } finally {
    await f.close();
  }
});
