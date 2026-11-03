import { test } from "node:test";
import assert from "node:assert/strict";
import { chatFixture } from "./chat-fixture.js";

test("参考調査のWeb検索を依頼・turn・itemに結び、空結果と失敗を保存して開き直せる", async () => {
  const f = await chatFixture();
  try {
    const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "港の参考資料を探して",
      role: "reference",
    });
    for (let i = 0; i < 100 && !(await f.view()).requests[0].turnId; i++)
      await new Promise((r) => setTimeout(r, 10));
    const running = (await f.view()).requests[0];
    f.notify("item/completed", {
      turnId: running.turnId,
      item: {
        id: "search-1",
        type: "webSearch",
        action: { type: "search", query: "港 写真" },
        status: "completed",
      },
    });
    f.notify("item/completed", {
      turnId: running.turnId,
      item: {
        id: "search-2",
        type: "webSearch",
        action: { type: "search", query: "missing" },
        status: "failed",
      },
    });
    const data = await f.read(`/api/works/${f.work.id}/references`);
    assert.equal(data.searches.length, 2);
    assert.equal(data.searches[0].requestId, r.id);
    assert.equal(data.searches[0].turnId, running.turnId);
    assert.equal(data.searches[0].itemId, "search-1");
    assert.equal(data.searches[0].status, "completed");
    assert.equal(data.searches[0].resultAvailability, "not_provided");
    assert.equal(data.searches[1].status, "failed");
    f.notify("item/completed", {
      turnId: running.turnId,
      item: {
        id: "search-3",
        type: "webSearch",
        query: "no results",
        action: { type: "search", query: "no results", queries: null },
        results: [],
      },
    });
    assert.equal(
      (await f.read(`/api/works/${f.work.id}/references`)).searches[2]
        .resultAvailability,
      "empty",
    );
    await f.restart();
    assert.equal(
      (await f.read(`/api/works/${f.work.id}/references`)).searches.length,
      3,
    );
  } finally {
    await f.close();
  }
});

import { mcp, waitFor } from "./mcp-fixture.js";
test("専用MCPで出典付き候補を保存し、人間の選択原文と画像未保持を再起動後も確認できる", async () => {
  const f = await chatFixture(true, false, async (url) => ({
    url,
    status: 200,
    mime: "text/html",
    bytes: Buffer.from("<p>Harbor photograph. Copyright unknown.</p>"),
  }));
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "港の参考を探して",
      role: "reference",
    });
    client = await mcp(f);
    let c = await client.current();
    const page = await client.call("fetch_reference_page", {
      contextRef: c.contextRef,
      url: "https://example.org/harbor",
      purpose: "港の構造",
    });
    assert.equal(page.result?.page.status, "available", JSON.stringify(page));
    const args = {
      contextRef: c.contextRef,
      operationId: crypto.randomUUID(),
      pageId: page.result.page.id,
      title: "港の写真",
      element: "石造りの岸壁",
      intentRelation: "夕暮れの静けさ",
      imageUrl: "https://example.org/harbor.jpg",
    };
    const saved = await client.call("save_reference", args);
    assert.equal(
      saved.result?.candidate.image.status,
      "not_retained",
      JSON.stringify(saved),
    );
    assert.deepEqual(await client.call("save_reference", args), saved);
    const candidate = saved.result.candidate;
    await waitFor(async () =>
      Boolean((await f.view()).requests.at(-1).terminal),
    );
    const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "「港の写真」を参考として選んで。岸壁の構造が分かるため。",
      role: "none",
    });
    c = await client.current();
    const chosen = await client.call("select_reference", {
      contextRef: c.contextRef,
      sourceRequestId: r.id,
      referenceId: candidate.id,
    });
    assert.equal(chosen.result?.complete, true, JSON.stringify(chosen));
    await f.restart();
    const view = await f.read(`/api/works/${f.work.id}/references`);
    assert.equal(view.candidates.length, 1);
    assert.equal(view.pages[0].text, "Harbor photograph. Copyright unknown.");
    assert.equal(
      view.selections[0].body,
      "「港の写真」を参考として選んで。岸壁の構造が分かるため。",
    );
    assert.equal(view.selections[0].author, "human");
  } finally {
    client?.close();
    await f.close();
  }
});

test("保存条件の根拠と画像を固定し、切れた画像・未選択候補・欠落でも本文と選択を保つ", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3iUAAAAASUVORK5CYII=",
    "base64",
  );
  let imageRequests = 0;
  const f = await chatFixture(true, true, async (url) => {
    if (url.endsWith(".png")) {
      imageRequests++;
      return {
        url,
        status: url.includes("missing") ? 404 : 200,
        mime: "image/png",
        bytes: png,
      };
    }
    return {
      url,
      status: 200,
      mime: "text/plain",
      bytes: Buffer.from(
        "This harbor image may be downloaded and retained as a reference. No production use permitted.",
      ),
    };
  });
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "参考調査をして",
      role: "reference",
    });
    client = await mcp(f);
    const c = await client.current();
    const page = (
      await client.call("fetch_reference_page", {
        contextRef: c.contextRef,
        url: "https://example.org/permission",
        purpose: "保存条件を調べる",
      })
    ).result.page;
    const args = {
      contextRef: c.contextRef,
      pageId: page.id,
      title: "保存できる港",
      element: "岸壁",
      intentRelation: "静けさ",
      imageUrl: "https://example.org/harbor.png",
      permissionPageId: page.id,
      permissionQuote:
        "This harbor image may be downloaded and retained as a reference.",
    };
    const key = crypto.randomUUID();
    const saved = await client.call("save_reference", {
      ...args,
      operationId: key,
    });
    assert.equal(
      saved.result?.candidate.image.status,
      "stored",
      JSON.stringify(saved),
    );
    assert.equal(saved.result.candidate.image.size, png.length);
    await client.call("save_reference", { ...args, operationId: key });
    assert.equal(imageRequests, 1);
    assert.equal(
      (
        await f.read(`/api/references/${saved.result.candidate.id}`)
      ).page.text.includes("No production use permitted."),
      true,
    );
    const broken = await client.call("save_reference", {
      ...args,
      title: "リンク切れの港",
      imageUrl: "https://example.org/missing.png",
    });
    assert.equal(broken.result.candidate.image.status, "broken");
    const unknown = await client.call("save_reference", {
      ...args,
      permissionQuote: "invented permission",
    });
    assert.equal(unknown.error, "IMAGE_PERMISSION_UNVERIFIED");
    assert.equal(imageRequests, 2);
    const image = await f.response(
      `/api/references/${saved.result.candidate.id}/image`,
    );
    assert.equal(image.statusCode, 200);
    assert.deepEqual(image.rawPayload, png);
    const { unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await unlink(
      join(f.directory, "managed/reference-images", saved.result.candidate.id),
    );
    assert.equal(
      (await f.response(`/api/references/${saved.result.candidate.id}/image`))
        .statusCode,
      404,
    );
    assert.equal(
      (await f.read(`/api/references/${saved.result.candidate.id}`)).candidate
        .title,
      "保存できる港",
    );
    const view = await f.read(`/api/works/${f.work.id}/references`);
    assert.equal(view.candidates.length, 2);
    assert.deepEqual(view.selections, []);
  } finally {
    client?.close();
    await f.close();
  }
});

test("ページ取得中の停止は停止記録を残し、新たな参考資料の確定・旧turnからの更新を拒否する", async () => {
  let entered = false;
  let release: (() => void) | undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const f = await chatFixture(true, false, async (url) => {
    entered = true;
    await held;
    return {
      url,
      status: 200,
      mime: "text/plain",
      bytes: Buffer.from("late page"),
    };
  });
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "参考を検索して",
      role: "reference",
    });
    client = await mcp(f);
    const c = await client.current();
    const pending = client.call("fetch_reference_page", {
      contextRef: c.contextRef,
      url: "https://example.org/held",
      purpose: "構造の確認",
    });
    await waitFor(async () => entered);
    await f.post(`/api/chat-requests/${r.id}/stop`);
    release!();
    assert.equal((await pending).error, "STALE_CONTEXT");
    const view = await f.read(`/api/works/${f.work.id}/references`);
    assert.equal(view.pages[0].status, "stopped");
    assert.equal(view.candidates.length, 0);
    assert.equal(
      (
        await client.call("save_reference", {
          contextRef: c.contextRef,
          pageId: view.pages[0].id,
          title: "late",
          element: "壁",
          intentRelation: "港",
        })
      ).error,
      "STALE_CONTEXT",
    );
  } finally {
    release?.();
    client?.close();
    await f.close();
  }
});

test("参考以外の工程は取得できず、参考工程だけWeb検索を有効にする", async () => {
  const f = await chatFixture();
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "参考調査",
      role: "reference",
    });
    await waitFor(async () => f.calls.some((c) => c.method === "turn/start"));
    assert.equal(
      f.calls.find((c) => c.method === "thread/start")?.params.config
        .web_search,
      "live",
    );
    const r = (await f.view()).requests[0];
    f.notify("turn/completed", {
      turn: { id: r.turnId, status: "completed", items: [] },
    });
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "工程なしの相談",
      role: "none",
    });
    await waitFor(async () =>
      f.calls.some((c) => c.method === "thread/resume"),
    );
    assert.equal(
      f.calls.find((c) => c.method === "thread/resume")?.params.config
        .web_search,
      "disabled",
    );
  } finally {
    await f.close();
  }
  const f2 = await chatFixture(true);
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f2.post(`/api/conversations/${f2.chat.id}/messages`, {
      body: "相談",
      role: "none",
    });
    client = await mcp(f2);
    const c = await client.current();
    assert.equal(
      (
        await client.call("fetch_reference_page", {
          contextRef: c.contextRef,
          url: "https://example.org",
          purpose: "test",
        })
      ).error,
      "REFERENCE_ROLE_REQUIRED",
    );
  } finally {
    client?.close();
    await f2.close();
  }
});

test("公開URL以外の取得・別作品の候補参照・選択していない指示を拒否する", async () => {
  let fetched = 0;
  const f = await chatFixture(true, false, async (url) => {
    fetched++;
    return { url, status: 404, mime: "text/plain", bytes: Buffer.alloc(0) };
  });
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "参考資料の検索をして",
      role: "reference",
    });
    client = await mcp(f);
    let c = await client.current();
    for (const url of [
      "file:///etc/passwd",
      "http://127.0.0.1/private",
      "http://169.254.169.254/latest",
      "http://[::1]/",
      "http://localhost/",
      "https://user:password@example.org/",
    ])
      assert.equal(
        (
          await client.call("fetch_reference_page", {
            contextRef: c.contextRef,
            url,
            purpose: "test",
          })
        ).error,
        "INVALID_REFERENCE_URL",
      );
    assert.equal(fetched, 0);
    const page = (
      await client.call("fetch_reference_page", {
        contextRef: c.contextRef,
        url: "https://example.org/missing",
        purpose: "構造の確認",
      })
    ).result.page;
    assert.equal(page.status, "broken");
    const candidate = (
      await client.call("save_reference", {
        contextRef: c.contextRef,
        pageId: page.id,
        title: "港資料",
        element: "岸壁",
        intentRelation: "港の静けさ",
      })
    ).result.candidate;
    await waitFor(async () =>
      Boolean((await f.view()).requests.at(-1).terminal),
    );
    const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "港資料は参考として選ばない",
      role: "none",
    });
    c = await client.current();
    const result = await client.call("select_reference", {
      contextRef: c.contextRef,
      sourceRequestId: r.id,
      referenceId: candidate.id,
    });
    assert.equal(result.result.needsClarification, true);
    assert.deepEqual(
      (await f.read(`/api/works/${f.work.id}/references`)).selections,
      [],
    );
    assert.equal(
      (
        await client.call("select_reference", {
          contextRef: c.contextRef,
          sourceRequestId: r.id,
          referenceId: crypto.randomUUID(),
        })
      ).error,
      "REFERENCE_NOT_FOUND",
    );
  } finally {
    client?.close();
    await f.close();
  }
});
