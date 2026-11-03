import { test } from "node:test";
import assert from "node:assert/strict";
import { chatFixture } from "./chat-fixture.js";
import { mcp, waitFor } from "./mcp-fixture.js";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export const planInput = {
  title: "港の計画",
  body: "岸壁と倉庫を作る。裏面構造は未確認。",
  referenceIds: [],
  parts: [
    {
      id: "quay",
      name: "岸壁",
      placement: "画面手前",
      dimensions: "幅10m、高さ2m（概寸）",
      order: 1,
    },
  ],
  hypotheses: [
    {
      id: "back",
      body: "倉庫裏側も石造",
      evidence: "正面の構造からの推測",
      missing: "裏側の写真なし",
    },
  ],
};
test("計画のDB確定失敗は完了扱いせず、同じ操作IDの再送で一度だけ保存する", async () => {
  const f = await chatFixture(true);
  const db = new DatabaseSync(join(f.directory, "records.sqlite"));
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "計画を作って",
      role: "planning",
    });
    client = await mcp(f);
    const c = await client.current();
    const args = {
      ...planInput,
      contextRef: c.contextRef,
      operationId: crypto.randomUUID(),
    };
    // Fault injection only; assertions use the public API, not DB contents.
    db.exec(
      "CREATE TRIGGER fail_plan_receipt BEFORE INSERT ON context_operations BEGIN SELECT RAISE(ABORT,'fault'); END",
    );
    assert.equal(
      (await client.call("save_scene_plan", args)).error,
      "RPC_REJECTED",
    );
    assert.deepEqual(
      (await f.read(`/api/works/${f.work.id}/scene-plans`)).plans,
      [],
    );
    db.exec("DROP TRIGGER fail_plan_receipt");
    assert.equal(
      (await client.call("save_scene_plan", args)).result.complete,
      true,
    );
    assert.equal(
      (await f.read(`/api/works/${f.work.id}/scene-plans`)).plans.length,
      1,
    );
    assert.equal(
      (await client.call("save_scene_plan", { ...args, title: "別計画" }))
        .error,
      "REQUEST_KEY_CONFLICT",
    );
    const other = await f.post("/api/works", { name: "別作品" });
    const otherChat = await f.post(`/api/works/${other.id}/conversations`);
    await waitFor(async () =>
      Boolean((await f.view()).requests.at(-1).terminal),
    );
    await f.post(`/api/conversations/${otherChat.id}/messages`, {
      body: "他作品の計画を採用して",
      role: "none",
    });
    // mcp.current follows the first chat; fetch the new chat's bound context from fixture output.
    const { readFile } = await import("node:fs/promises");
    let next: any;
    await waitFor(async () => {
      next = JSON.parse(
        JSON.parse(
          await readFile(
            join(f.directory, "codex/fixture-context.json"),
            "utf8",
          ),
        )["scene-craft"].value,
      );
      return next.sourceRequestId !== c.sourceRequestId;
    });
    // Use its conversation credential through a fresh MCP adapter.
    const otherClient = await mcp(f);
    try {
      const saved = (await f.read(`/api/works/${f.work.id}/scene-plans`))
        .plans[0];
      assert.equal(
        (
          await otherClient.call("record_human_decision", {
            contextRef: next.contextRef,
            sourceRequestId: next.sourceRequestId,
            planId: saved.id,
          })
        ).error,
        "SCENE_PLAN_NOT_FOUND",
      );
    } finally {
      otherClient.close();
    }
  } finally {
    db.close();
    client?.close();
    await f.close();
  }
});
test("計画の構造と未採用仮説をMCPから保存してHTTPで開き直せる", async () => {
  const f = await chatFixture(true);
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "港のシーン計画を作って",
      role: "planning",
    });
    client = await mcp(f);
    const c = await client.current();
    const args = {
      ...planInput,
      contextRef: c.contextRef,
      operationId: crypto.randomUUID(),
    };
    const saved = await client.call("save_scene_plan", args);
    assert.equal(saved.result?.complete, true, JSON.stringify(saved));
    assert.deepEqual(await client.call("save_scene_plan", args), saved);
    await f.restart();
    const view = await f.read(`/api/works/${f.work.id}/scene-plans`);
    assert.equal(view.plans.length, 1);
    assert.deepEqual(view.plans[0].parts, planInput.parts);
    assert.deepEqual(view.plans[0].hypotheses, planInput.hypotheses);
    assert.deepEqual(view.decisions, []);
    assert.equal(view.plans[0].source.requestId, c.sourceRequestId);
  } finally {
    client?.close();
    await f.close();
  }
});

test("計画と仮説の判断を分離し、相談を拒否して修正前・原文・判断履歴を保持する", async () => {
  const f = await chatFixture(true);
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "計画を作って",
      role: "planning",
    });
    client = await mcp(f);
    let c = await client.current();
    const saved = await client.call("save_scene_plan", {
      ...planInput,
      contextRef: c.contextRef,
    });
    const planId = saved.result.plan.id;
    async function decide(body: string, hypothesisId?: string) {
      await waitFor(async () =>
        Boolean((await f.view()).requests.at(-1).terminal),
      );
      const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
        body,
        role: "none",
      });
      c = await client!.current();
      return client!.call("record_human_decision", {
        contextRef: c.contextRef,
        sourceRequestId: r.id,
        planId,
        ...(hypothesisId ? { hypothesisId } : {}),
      });
    }
    const accepted = await decide("「港の計画」を採用して。構図が合うため。");
    assert.equal(
      accepted.result?.decision.action,
      "accept",
      JSON.stringify(accepted),
    );
    assert.equal(accepted.result.decision.hypothesisId, null);
    assert.equal(accepted.result.decision.author, "human");
    assert.ok(accepted.result.decision.createdAt);
    const duplicate = await client.call("record_human_decision", {
      contextRef: c.contextRef,
      sourceRequestId: c.sourceRequestId,
      planId,
    });
    assert.equal(duplicate.result.decision.id, accepted.result.decision.id);
    assert.equal(
      (await decide("「港の計画」の仮説backを採用して。", "back")).result
        .decision.action,
      "accept",
    );
    assert.equal(
      (await decide("「港の計画」の仮説backは保留して。", "back")).result
        .decision.action,
      "hold",
    );
    assert.equal(
      (await decide("「港の計画」を修正して。岸壁の幅を12mにして。")).result
        .decision.action,
      "revise",
    );
    const no = await decide("「港の計画」を採用して。この文を英語に翻訳して。");
    assert.equal(no.result.complete, false);
    assert.equal(no.result.needsClarification, true);
    assert.equal(
      (
        await client.call("save_scene_plan", {
          ...planInput,
          contextRef: c.contextRef,
        })
      ).error,
      "PLANNING_ROLE_REQUIRED",
    );
    await waitFor(async () =>
      Boolean((await f.view()).requests.at(-1).terminal),
    );
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "修正案を作って",
      role: "planning",
    });
    c = await client.current();
    const revised = await client.call("save_scene_plan", {
      ...planInput,
      contextRef: c.contextRef,
      previousPlanId: planId,
      parts: [{ ...planInput.parts[0], dimensions: "幅12m、高さ2m" }],
    });
    assert.equal(revised.result.plan.previousPlanId, planId);
    await f.restart();
    const view = await f.read(`/api/works/${f.work.id}/scene-plans`);
    assert.equal(view.plans.length, 2);
    assert.equal(view.plans[0].parts[0].dimensions, "幅10m、高さ2m（概寸）");
    assert.equal(view.decisions.length, 4);
    assert.equal(
      view.decisions[0].body,
      "「港の計画」を採用して。構図が合うため。",
    );
    assert.ok(view.decisions.every((d: any) => d.planId === planId));
    assert.ok(
      (await f.view()).requests.every((r: any) =>
        ["planning", "none"].includes(r.role),
      ),
    );
  } finally {
    client?.close();
    await f.close();
  }
});

test("未選択参考・不正構造・他作品・停止済みturnからの計画保存を拒否する", async () => {
  const f = await chatFixture(true);
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "計画を作って",
      role: "planning",
    });
    client = await mcp(f);
    const c = await client.current();
    const args = { ...planInput, contextRef: c.contextRef };
    assert.equal(
      (
        await client.call("save_scene_plan", {
          ...args,
          referenceIds: [crypto.randomUUID()],
        })
      ).error,
      "REFERENCE_NOT_SELECTED_AT_REQUEST",
    );
    assert.equal(
      (await client.call("save_scene_plan", { ...args, parts: [] })).error,
      "INVALID_SCENE_PLAN_ARGUMENTS",
    );
    assert.equal(
      (
        await client.call("save_scene_plan", {
          ...args,
          parts: [planInput.parts[0], planInput.parts[0]],
        })
      ).error,
      "DUPLICATE_PLAN_ITEM",
    );
    assert.equal(
      (await client.call("save_scene_plan", { ...args, accepted: true })).error,
      "INVALID_SCENE_PLAN_ARGUMENTS",
    );
    const saved = await client.call("save_scene_plan", args);
    const other = await f.post("/api/works", { name: "別作品" });
    assert.deepEqual(
      (await f.read(`/api/works/${other.id}/scene-plans`)).plans,
      [],
    );
    await f.post(`/api/chat-requests/${c.sourceRequestId}/stop`);
    assert.equal(
      (await client.call("save_scene_plan", args)).error,
      "STALE_CONTEXT",
    );
    assert.equal(
      (await f.read(`/api/scene-plans/${saved.result.plan.id}`)).plan.id,
      saved.result.plan.id,
    );
  } finally {
    client?.close();
    await f.close();
  }
});
