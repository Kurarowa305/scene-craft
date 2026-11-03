#!/usr/bin/env node
// External protocol fixture only; the application uses its production stdio adapter.
import { createInterface } from "node:readline";
let next = 0;
const threads = new Map();
const send = (v) => process.stdout.write(JSON.stringify(v) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  const p = m.params ?? {};
  if (!m.id) return;
  let result = {};
  if (m.method === "test/exit") {
    process.kill(process.pid, "SIGKILL");
    return;
  }
  if (m.method === "initialize") result = { userAgent: "codex-fixture/1" };
  if (m.method === "account/read") result = { account: { type: "chatgpt" } };
  if (m.method === "model/list")
    result = {
      data: ["fixture-a", "fixture-b"].map((model, i) => ({
        id: model,
        model,
        displayName: model,
        isDefault: i === 0,
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "high" },
        ],
      })),
      nextCursor: null,
    };
  if (m.method === "thread/start" || m.method === "thread/resume") {
    const id = p.threadId ?? `thread-${++next}`;
    if (!threads.has(id)) threads.set(id, []);
    result = { thread: { id }, model: p.model, modelProvider: "openai" };
  }
  if (m.method === "turn/start") {
    const turn = { id: `turn-${++next}`, status: "inProgress", items: [] };
    threads.get(p.threadId).push(turn);
    result = { turn };
    setTimeout(() => {
      if (turn.status !== "inProgress") return;
      send({
        method: "item/agentMessage/delta",
        params: {
          threadId: p.threadId,
          turnId: turn.id,
          itemId: `item-${turn.id}`,
          delta: "保存される返答",
        },
      });
    }, 150);
    setTimeout(() => {
      if (turn.status !== "inProgress") return;
      turn.status = "completed";
      turn.items = [
        { id: `item-${turn.id}`, type: "agentMessage", text: "保存される返答" },
      ];
      send({
        method: "item/completed",
        params: { threadId: p.threadId, turnId: turn.id, item: turn.items[0] },
      });
      send({
        method: "turn/completed",
        params: { threadId: p.threadId, turn },
      });
    }, 1200);
  }
  if (m.method === "turn/interrupt") {
    const turn = threads.get(p.threadId)?.find((t) => t.id === p.turnId);
    if (turn) {
      turn.status = "interrupted";
      send({
        method: "turn/completed",
        params: { threadId: p.threadId, turn },
      });
    }
  }
  if (m.method === "thread/turns/list")
    result = { data: threads.get(p.threadId) ?? [], nextCursor: null };
  if (m.method === "thread/items/list")
    result = {
      data: (threads.get(p.threadId) ?? [])
        .filter((t) => !p.turnId || t.id === p.turnId)
        .flatMap((t) => t.items.map((item) => ({ turnId: t.id, item }))),
      nextCursor: null,
    };
  send({ id: m.id, result });
});
