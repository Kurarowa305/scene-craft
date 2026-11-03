#!/usr/bin/env node
// External protocol fixture only; the application uses its production stdio adapter.
import { createInterface } from "node:readline";
import { writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
async function recordInstruction(context, body, threadId) {
  const naturalTools = {
    "直前の記録の「空」を「海」に変更して": "update_manual_record",
    "直前の記録に「静けさを出すため」を追記して": "update_manual_record",
    "制作意図の「静かな」を「賑やかな」に変更して": "update_work_intent",
    "制作意図に「夕方の光を重視」を追記して": "update_work_intent",
  };
  const tool =
    context.explicitRecordInstruction?.tool ??
    naturalTools[body] ??
    (body === "手作業で「Photoshopで空の色を調整した」を記録して"
      ? "create_manual_record"
      : null);
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
    if (threadEnvironments.get(id))
      writeFileSync(
        join(process.env.CODEX_HOME, "fixture-mcp.json"),
        JSON.stringify(threadEnvironments.get(id) ?? {}),
      );
    result = { thread: { id }, model: p.model, modelProvider: "openai" };
    if (
      p.baseInstructions?.startsWith("Interpret the CURRENT human message") &&
      existsSync(join(process.env.CODEX_HOME, "hold-interpretation-start"))
    ) {
      writeFileSync(
        join(process.env.CODEX_HOME, "fixture-interpretation-start-held"),
        "ready",
      );
      setTimeout(
        () => send({ id: m.id, result: { ...result, model: "fixture-b" } }),
        650,
      );
      return;
    }
  }
  if (m.method === "thread/unsubscribe") result = { status: "unsubscribed" };
  if (m.method === "turn/start") {
    const turn = { id: `turn-${++next}`, status: "inProgress", items: [] };
    threads.get(p.threadId).push(turn);
    result = { turn };
    if (p.outputSchema?.properties?.text) {
      const input = JSON.parse(p.input[0].text);
      turn.status = "completed";
      turn.items = [
        {
          id: `item-${turn.id}`,
          type: "agentMessage",
          text: JSON.stringify({
            text:
              input.kind === "name"
                ? "港の光の検討"
                : "港の光を検討した。採用は未確定。",
          }),
        },
      ];
      send({ id: m.id, result: { turn } });
      return;
    }
    if (p.outputSchema) {
      // Recorded external semantic outputs for the public contract tests.
      // This fixture is not a natural-language parser used by the product.
      const input = JSON.parse(p.input[0].text);
      writeFileSync(
        join(process.env.CODEX_HOME, "fixture-interpretation-started.json"),
        JSON.stringify({ request: p.clientUserMessageId }),
      );
      const explicitTarget = input.currentHumanMessage.match(
        /^記録([a-f0-9-]{36})の「空」を「海」に変更して$/,
      )?.[1];
      const examples = {
        ...(explicitTarget
          ? {
              [input.currentHumanMessage]: {
                tool: "update_manual_record",
                field: "body",
                mode: "edit",
                targetId: explicitTarget,
                body: input.recentRecords
                  .find((record) => record.id === explicitTarget)
                  ?.body.replace("空", "海"),
              },
            }
          : {}),
        "制作意図の「静かな」を「賑やかな」に変更して": {
          tool: "update_work_intent",
          field: "intent",
          mode: "edit",
          body: "賑やかな港",
          targetId: null,
        },
        "直前の記録の「空」を「海」に変更して": {
          tool: "update_manual_record",
          field: "body",
          mode: "edit",
          body: input.recentRecords[0]?.body.replace("空", "海"),
          targetId: input.recentRecords[0]?.id ?? null,
        },
        "手作業で「Photoshopで空の色を調整した」を記録して": {
          tool: "create_manual_record",
          field: "body",
          body: "Photoshopで空の色を調整した",
          targetId: null,
        },
        "制作意図を「夕暮れの港」に変えてください": {
          tool: "create_work_intent",
          field: "intent",
          body: "夕暮れの港",
          targetId: null,
        },
        "直前の記録に「静けさを出すため」を追記して": {
          tool: "update_manual_record",
          field: "body",
          mode: "append",
          body: "静けさを出すため",
          targetId: input.recentRecords[0]?.id ?? null,
        },
        "制作意図に「夕方の光を重視」を追記して": {
          tool: "update_work_intent",
          field: "intent",
          mode: "append",
          body: "夕方の光を重視",
          targetId: null,
        },
        "直前の記録の全文を「空と照明を調整した。落ち着いた雰囲気にするため。」に変更して":
          {
            tool: "create_manual_record",
            field: "body",
            mode: "replace",
            body: "空と照明を調整した。落ち着いた雰囲気にするため。",
            targetId: input.recentRecords[0]?.id ?? null,
          },
        原文にない文章を返す故障を検査: {
          tool: "create_manual_record",
          field: "body",
          body: "原文に存在しない本文",
          targetId: null,
        },
      };
      const value = examples[input.currentHumanMessage];
      if (input.currentHumanMessage === "解釈中の停止を検査する記録依頼") {
        send({ id: m.id, result: { turn } });
        return;
      }
      if (input.currentHumanMessage === "解釈時の利用上限を検査する記録依頼") {
        turn.status = "failed";
        turn.error = { codexErrorInfo: "usageLimitExceeded" };
        send({ id: m.id, result: { turn } });
        return;
      }
      const answer = value
        ? {
            status: "update",
            action:
              value.mode === "append" || value.mode === "edit"
                ? "update"
                : "create",
            mode: "replace",
            baseText:
              value.mode === "append" || value.mode === "edit"
                ? value.field === "intent"
                  ? input.currentIntent
                  : input.recentRecords.find(
                      (record) => record.id === value.targetId,
                    )?.body
                : null,
            ...value,
            question: null,
          }
        : input.currentHumanMessage === "その記録をいい感じに直して"
          ? {
              status: "clarification",
              action: null,
              baseText: null,
              tool: null,
              field: null,
              mode: null,
              body: null,
              targetId: null,
              question: "どの記録のどの文章を、どの内容に訂正しますか？",
            }
          : {
              status: "not_requested",
              action: null,
              baseText: null,
              tool: null,
              field: null,
              mode: null,
              body: null,
              targetId: null,
              question: null,
            };
      turn.status = "completed";
      turn.items = [
        {
          id: `item-${turn.id}`,
          type: "agentMessage",
          text: JSON.stringify({ result: answer }),
        },
      ];
      send({ id: m.id, result: { turn } });
      return;
    }
    if (p.additionalContext) {
      writeFileSync(
        join(process.env.CODEX_HOME, "fixture-context.tmp"),
        JSON.stringify(p.additionalContext),
      );
      renameSync(
        join(process.env.CODEX_HOME, "fixture-context.tmp"),
        join(process.env.CODEX_HOME, "fixture-context.json"),
      );
    }
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
