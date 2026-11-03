#!/usr/bin/env node
// External protocol fixture only; the application uses its production stdio adapter.
import { createInterface } from "node:readline";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
async function recordInstruction(context, body, threadId) {
  const tool = body.startsWith("制作意図を更新: ")
    ? "update_work_context"
    : body.startsWith("手作業を記録: ")
      ? "record_manual_work"
      : body.startsWith("記録を訂正: ")
        ? "amend_record"
        : null;
  if (!tool) return "保存される返答";
  const config = readFileSync(
    join(process.env.CODEX_HOME, "config.toml"),
    "utf8",
  );
  const get = (key) =>
    JSON.parse(new RegExp("^" + key + " = (.+)$", "m").exec(config)[1]);
  const child = spawn(get("command"), get("args"), {
    env: {
      ...process.env,
      ...threadEnvironments.get(threadId),
    },
    stdio: "pipe",
  });
  child.stderr.resume();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve("記録できませんでした");
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve("記録できませんでした");
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const reply = JSON.parse(line);
      if (reply.id === 1)
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: tool,
              arguments: {
                contextRef: context.contextRef,
                sourceRequestId: context.sourceRequestId,
                operationId: crypto.randomUUID(),
              },
            },
          }) + "\n",
        );
      if (reply.id === 2) {
        child.kill();
        resolve(
          reply.result.isError
            ? "記録できませんでした"
            : "明示した内容を記録しました",
        );
      }
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }) + "\n",
    );
    child.on("error", () => resolve("記録できませんでした"));
  });
}
let next = 0;
const threads = new Map();
const threadEnvironments = new Map();
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
  if (m.method === "skills/list")
    result = { data: [{ skills: [], errors: [] }] };
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
    threadEnvironments.set(id, p.config?.["mcp_servers.scene_craft.env"]);
    writeFileSync(
      join(process.env.CODEX_HOME, "fixture-mcp.json"),
      JSON.stringify(threadEnvironments.get(id) ?? {}),
    );
    result = { thread: { id }, model: p.model, modelProvider: "openai" };
  }
  if (m.method === "thread/unsubscribe") result = { status: "unsubscribed" };
  if (m.method === "turn/start") {
    const turn = { id: `turn-${++next}`, status: "inProgress", items: [] };
    threads.get(p.threadId).push(turn);
    result = { turn };
    if (p.additionalContext)
      writeFileSync(
        join(process.env.CODEX_HOME, "fixture-context.json"),
        JSON.stringify(p.additionalContext),
      );
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
    setTimeout(async () => {
      if (turn.status !== "inProgress") return;
      const text = await recordInstruction(
        JSON.parse(p.additionalContext?.["scene-craft"]?.value ?? "{}"),
        p.input[0].text,
        p.threadId,
      );
      if (turn.status !== "inProgress") return;
      turn.status = "completed";
      turn.items = [{ id: `item-${turn.id}`, type: "agentMessage", text }];
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
