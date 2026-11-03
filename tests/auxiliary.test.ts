import { test } from "node:test";
import assert from "node:assert/strict";
import { chatFixture } from "./chat-fixture.js";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

async function until(read: () => Promise<any>, check: (value: any) => boolean) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const value = await read();
    if (check(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("公開操作の保存結果が制限時間内に確定しなかった");
}

test("要約中に次の依頼が完了しても、その区切りの追加原文を後続要約へ送る", async () => {
  const f = await chatFixture();
  let release: (() => void) | undefined;
  let summaries = 0;
  try {
    await f.post("/api/auxiliary/model", { model: "a" });
    f.setHook((method, p) => {
      if (
        method === "thread/start" &&
        p.baseInstructions?.startsWith("scene-craft auxiliary")
      )
        return {
          thread: { id: `aux-${f.calls.length}` },
          model: p.model,
          modelProvider: "openai",
        };
      if (method === "turn/start" && p.outputSchema?.properties?.text) {
        const kind = JSON.parse(p.input[0].text).kind;
        const turn = {
          id: `aux-turn-${f.calls.length}`,
          status: "completed",
          items: [
            {
              type: "agentMessage",
              text: JSON.stringify({
                text: kind === "name" ? "港の検討" : "追加原文の要約",
              }),
            },
          ],
        };
        if (kind === "summary" && ++summaries === 1)
          return new Promise((resolve) => {
            release = () => resolve({ turn });
          });
        return { turn };
      }
    });
    await f.send();
    let r = (await f.view()).requests[0];
    f.notify("turn/completed", {
      turn: { id: r.turnId, status: "completed", items: [] },
    });
    await until(f.view, (v) =>
      v.auxiliary.jobs.some(
        (j: any) => j.kind === "summary" && j.status === "running",
      ),
    );
    const second = await f.send();
    r = (await f.view()).requests[1];
    f.notify("turn/completed", {
      turn: { id: r.turnId, status: "completed", items: [] },
    });
    release?.();
    const result = await until(
      f.view,
      (v) => v.auxiliary.summaries.length === 2,
    );
    assert.ok(
      result.auxiliary.summaries[1].sources.some(
        (s: any) => s.id === `request:${second.id}`,
      ),
    );
    assert.equal(result.auxiliary.pending.length, 0);
  } finally {
    release?.();
    await f.close();
  }
});

test("補助結果のDB保存失敗で制作プロセスを終了せず、原文の閲覧と記録を続けられる", async () => {
  const f = await chatFixture();
  let release: (() => void) | undefined;
  const db = new DatabaseSync(join(f.directory, "records.sqlite"));
  try {
    await f.post("/api/auxiliary/model", { model: "a" });
    f.setHook((method, p) => {
      if (
        method === "thread/start" &&
        p.baseInstructions?.startsWith("scene-craft auxiliary")
      )
        return {
          thread: { id: "aux-thread" },
          model: p.model,
          modelProvider: "openai",
        };
      if (method === "turn/start" && p.threadId === "aux-thread")
        return new Promise((resolve) => {
          release = () =>
            resolve({
              turn: {
                id: "aux-done",
                status: "completed",
                items: [
                  {
                    type: "agentMessage",
                    text: JSON.stringify({ text: "保存に失敗する会話名" }),
                  },
                ],
              },
            });
        });
    });
    await f.send();
    await until(f.view, (v) => v.auxiliary.jobs[0]?.status === "running");
    // Inject a real SQLite write failure only at the auxiliary storage boundary.
    db.exec(
      "CREATE TRIGGER fail_auxiliary BEFORE UPDATE ON auxiliary_jobs BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;",
    );
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const view = await f.view();
    assert.equal(view.auxiliary.name, null);
    assert.equal(view.requests[0].body, "保持する原文");
    await f.post(`/api/conversations/${f.chat.id}/records`, {
      body: "補助失敗後の手作業記録",
    });
    assert.equal(
      (await f.read(`/api/conversations/${f.chat.id}/records`))[0].body,
      "補助失敗後の手作業記録",
    );
    db.exec("DROP TRIGGER fail_auxiliary");
    await f.restart();
    assert.equal(
      (await f.view()).auxiliary.jobs[0].error,
      "PROCESS_INTERRUPTED",
    );
  } finally {
    release?.();
    db.close();
    await f.close();
  }
});

test("追加原文のみを要約し、初回名を維持し、次の依頼へ訂正済み要約と最新の制作意図を渡す", async () => {
  const f = await chatFixture(true);
  try {
    await f.post("/api/auxiliary/model", { model: "fixture-a" });
    await f.send();
    const first = await until(
      f.view,
      (v) => v.auxiliary.summaries.length === 1,
    );
    const summary = first.auxiliary.summaries[0];
    await f.post(`/api/conversations/${f.chat.id}/summaries/${summary.id}`, {
      body: "人間の訂正: 採用前の検討",
    });
    const second = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "光の色を相談したい",
    });
    const next = await until(f.view, (v) => v.auxiliary.summaries.length === 3);
    assert.equal(
      next.auxiliary.jobs.filter((j: any) => j.kind === "name").length,
      1,
    );
    const addition = next.auxiliary.summaries[2];
    assert.ok(
      addition.sources.some((s: any) => s.id === `request:${second.id}`),
    );
    assert.ok(
      addition.sources.every(
        (s: any) => !summary.sources.some((old: any) => old.id === s.id),
      ),
    );
    assert.equal(next.auxiliary.pending.length, 0);
    const fixed = next.requests[1].contextSnapshot;
    assert.equal(fixed.work.intent, null);
    assert.equal(
      fixed.conversationSummaries[0].summaries[0].body,
      "人間の訂正: 採用前の検討",
    );
    assert.equal(fixed.conversationSummaries[0].summaries.length, 1);
  } finally {
    await f.close();
  }
});

test("補助側の利用上限では要約を起動せず、明示再開の同一キー再送は重複起動しない", async () => {
  const f = await chatFixture();
  let failed = true;
  try {
    await f.post("/api/auxiliary/model", { model: "a" });
    f.setHook((method, p) => {
      if (
        method === "thread/start" &&
        p.baseInstructions?.startsWith("scene-craft auxiliary")
      )
        return {
          thread: { id: "aux-thread" },
          model: p.model,
          modelProvider: "openai",
        };
      if (method === "turn/start" && p.threadId === "aux-thread")
        return {
          turn: failed
            ? {
                id: "limited",
                status: "failed",
                error: { codexErrorInfo: "usageLimitExceeded" },
                items: [],
              }
            : {
                id: "done",
                status: "completed",
                items: [
                  {
                    type: "agentMessage",
                    text: JSON.stringify({ text: "明示再開した結果" }),
                  },
                ],
              },
        };
    });
    await f.send();
    const production = (await f.view()).requests[0];
    f.notify("turn/completed", {
      turn: { id: production.turnId, status: "completed", items: [] },
    });
    const stopped = await until(f.view, (v) =>
      v.auxiliary.jobs.every(
        (j: any) => !["pending", "running"].includes(j.status),
      ),
    );
    assert.equal(stopped.requests[0].phase, "completed");
    assert.equal(stopped.auxiliary.summaries.length, 0);
    assert.equal(
      f.calls.filter(
        (c) => c.method === "turn/start" && c.params.threadId === "aux-thread",
      ).length,
      1,
    );
    failed = false;
    const payload = { requestKey: "explicit-resume-key" };
    await f.post(`/api/conversations/${f.chat.id}/auxiliary/resume`, payload);
    await until(f.view, (v) => v.auxiliary.summaries.length === 1);
    const count = f.calls.filter((c) => c.method === "turn/start").length;
    await f.post(`/api/conversations/${f.chat.id}/auxiliary/resume`, payload);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(
      f.calls.filter((c) => c.method === "turn/start").length,
      count,
    );
  } finally {
    await f.close();
  }
});

test("補助モデルのrerouteは制作を止めず未命名として保存し、補助turnを開始しない", async () => {
  const f = await chatFixture();
  try {
    await f.post("/api/auxiliary/model", { model: "a" });
    f.setHook((method, p) => {
      if (
        method === "thread/start" &&
        p.baseInstructions?.startsWith("scene-craft auxiliary")
      )
        return {
          thread: { id: "rerouted-aux" },
          model: "b",
          modelProvider: "openai",
        };
    });
    await f.send();
    const v = await f.view();
    assert.equal(v.auxiliary.name, null);
    assert.equal(v.auxiliary.jobs[0].error, "MODEL_REROUTED");
    assert.equal(v.auxiliary.jobs[0].actualModel, "b");
    assert.equal(v.requests[0].phase, "running");
    assert.equal(
      f.calls.filter(
        (c) =>
          c.method === "turn/start" && c.params.threadId === "rerouted-aux",
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("補助モデルの初期値を保持し、記録専用送信では補助処理を起動しない", async () => {
  const f = await chatFixture();
  try {
    const before = await f.view();
    assert.equal(before.auxiliary.model, "gpt-6-luna");
    await f.post(`/api/conversations/${f.chat.id}/records`, {
      body: "空を調整した",
    });
    const after = await f.view();
    assert.equal(after.auxiliary.jobs.length, 0);
    assert.equal(after.auxiliary.pending.length, 1);
    assert.equal(f.calls.filter((c) => c.method === "turn/start").length, 0);
    await f.restart();
    assert.equal((await f.view()).auxiliary.pending.length, 1);
  } finally {
    await f.close();
  }
});

for (const reason of ["stop", "usageLimitExceeded", "unauthorized"]) {
  test(`命名中の${reason}後は要約を始めず、原文と未要約を保持する`, async () => {
    const f = await chatFixture();
    try {
      await f.post("/api/auxiliary/model", { model: "a" });
      f.setHook((method, p) => {
        if (
          method === "thread/start" &&
          p.baseInstructions?.startsWith("scene-craft auxiliary")
        )
          return {
            thread: { id: "aux-thread" },
            model: p.model,
            modelProvider: "openai",
          };
        if (method === "turn/start" && p.threadId === "aux-thread")
          return { turn: { id: "aux-name", status: "inProgress", items: [] } };
      });
      const r = await f.send();
      const turnId = (await f.view()).requests[0].turnId;
      if (reason === "stop") await f.post(`/api/chat-requests/${r.id}/stop`);
      else
        f.notify("error", {
          turnId,
          error: { codexErrorInfo: reason },
          willRetry: false,
        });
      f.notify("turn/completed", {
        turn: { id: turnId, status: "interrupted", items: [] },
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      const v = await f.view();
      assert.equal(v.auxiliary.name, null);
      assert.equal(v.auxiliary.summaries.length, 0);
      assert.ok(
        v.auxiliary.pending.some((s: any) => s.body === "保持する原文"),
      );
      assert.equal(
        v.auxiliary.jobs.filter((j: any) => j.kind === "summary").length,
        0,
      );
      assert.equal(v.auxiliary.jobs[0].status, "stopped");
    } finally {
      await f.close();
    }
  });
}

test("制作結果を待たせず別threadで命名・追加原文要約し、人間名と要約の訂正履歴を保持する", async () => {
  const f = await chatFixture();
  try {
    await f.post("/api/auxiliary/model", { model: "a" });
    let release: (() => void) | undefined;
    f.setHook((method, p) => {
      if (
        method === "thread/start" &&
        p.baseInstructions?.startsWith("scene-craft auxiliary")
      )
        return {
          thread: { id: "aux-thread" },
          model: p.model,
          modelProvider: "openai",
        };
      if (method === "turn/start" && p.threadId === "aux-thread") {
        const data = JSON.parse(p.input[0].text);
        const text =
          data.kind === "name"
            ? "港の光の検討"
            : "港の光を検討した。採用は未確定。";
        const turn = {
          id: `aux-${data.kind}`,
          status: "completed",
          items: [
            {
              id: `result-${data.kind}`,
              type: "agentMessage",
              text: JSON.stringify({ text }),
            },
          ],
        };
        if (data.kind === "name")
          return new Promise((resolve) => {
            release = () => resolve({ turn });
          });
        return { turn };
      }
    });
    const r = await f.send();
    await f.post(`/api/conversations/${f.chat.id}/name`, {
      name: "人間の会話名",
    });
    await f.post("/api/auxiliary/model", { model: "b" });
    const productionTurn = (await f.view()).requests[0].turnId;
    f.notify("turn/completed", {
      turn: {
        id: productionTurn,
        status: "completed",
        items: [
          { id: "answer", type: "agentMessage", text: "光を検討しました" },
        ],
      },
    });
    assert.equal((await f.view()).requests[0].phase, "completed");
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const v = await f.view();
    assert.equal(v.auxiliary.name, "人間の会話名");
    assert.equal(
      v.auxiliary.jobs.find((j: any) => j.kind === "name").model,
      "a",
    );
    const s = v.auxiliary.summaries[0];
    assert.equal(s.body, "港の光を検討した。採用は未確定。");
    assert.ok(s.sources.some((t: any) => t.id === `request:${r.id}`));
    assert.ok(s.sources.some((t: any) => t.body === "光を検討しました"));
    assert.equal(v.auxiliary.pending.length, 0);
    await f.post(`/api/conversations/${f.chat.id}/summaries/${s.id}`, {
      body: "人間による訂正",
    });
    await f.restart();
    const saved = (await f.view()).auxiliary;
    assert.equal(saved.summaries[0].body, s.body);
    assert.equal(saved.summaries[1].previousId, s.id);
    assert.equal(saved.summaries[1].author, "human");
    assert.ok(
      f.calls
        .filter(
          (c) =>
            c.method === "thread/start" &&
            c.params.baseInstructions?.startsWith("scene-craft auxiliary"),
        )
        .every(
          (c) => c.params.config["mcp_servers.scene_craft.enabled"] === false,
        ),
    );
  } finally {
    await f.close();
  }
});
