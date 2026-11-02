import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";

const origin = "http://localhost:4317";
test("作品・空の会話・原文を公開操作で保存し、再起動後に同じIDと確定順で読む", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-craft-"));
  let app = await createApp({ directory, port: 4317 });
  try {
    const session = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    const headers = {
      host: "localhost:4317",
      origin,
      cookie: session.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": session.json().csrfToken,
    };
    const post = async (url: string, payload: Record<string, unknown>) => {
      const result = await app.inject({
        method: "POST",
        url,
        headers,
        payload,
      });
      assert.equal(result.statusCode, 200, result.body);
      return result.json();
    };
    const work = await post("/api/works", {
      requestKey: "work-0001",
      name: "夕暮れの港",
      intent: " 静けさ\n余韻 ",
    });
    assert.equal(work.style, null);
    const first = await post(`/api/works/${work.id}/conversations`, {
      requestKey: "chat-0001",
    });
    const second = await post(`/api/works/${work.id}/conversations`, {
      requestKey: "chat-0002",
    });
    assert.equal(first.title, null);
    const empty = await app.inject({
      url: `/api/conversations/${first.id}/records`,
      headers,
    });
    assert.deepEqual(empty.json(), []);
    const one = await post(`/api/conversations/${first.id}/records`, {
      requestKey: "record-0001",
      body: "  手作業の原文\r\n<script>文字として保持</script>\n",
    });
    const two = await post(`/api/conversations/${first.id}/records`, {
      requestKey: "record-0002",
      body: "次の記録",
    });
    await app.close();
    app = await createApp({ directory, port: 4317 });
    const read = async (url: string) =>
      (await app.inject({ url, headers: { host: "localhost:4317" } })).json();
    assert.deepEqual(await read("/api/works"), [work]);
    assert.deepEqual(await read(`/api/works/${work.id}/conversations`), [
      first,
      second,
    ]);
    assert.deepEqual(await read(`/api/conversations/${first.id}/records`), [
      one,
      two,
    ]);
    assert.equal(
      one.body,
      "  手作業の原文\r\n<script>文字として保持</script>\n",
    );
    assert.equal(one.author, "human");
    assert.equal(one.kind, "record");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("受付応答喪失後の再送は全操作で一度だけ保存し、異内容・異対象を拒否する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-craft-"));
  let app = await createApp({ directory, port: 4317 });
  try {
    const login = async () => {
      const result = await app.inject({
        url: "/api/session",
        headers: { host: "localhost:4317" },
      });
      return {
        host: "localhost:4317",
        origin,
        cookie: result.headers["set-cookie"]!.toString().split(";")[0],
        "x-csrf-token": result.json().csrfToken,
      };
    };
    let headers = await login();
    const post = (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url, headers, payload });
    const workPayload = { requestKey: "work-once", name: "港" };
    const work = (await post("/api/works", workPayload)).json();
    const conversationPayload = { requestKey: "chat-once" };
    const chat = (
      await post(`/api/works/${work.id}/conversations`, conversationPayload)
    ).json();
    const recordPayload = { requestKey: "record-once", body: "最初の原文" };
    const record = (
      await post(`/api/conversations/${chat.id}/records`, recordPayload)
    ).json();
    await app.close();
    app = await createApp({ directory, port: 4317 });
    headers = await login();
    assert.deepEqual((await post("/api/works", workPayload)).json(), work);
    assert.deepEqual(
      (
        await post(`/api/works/${work.id}/conversations`, conversationPayload)
      ).json(),
      chat,
    );
    const replies = await Promise.all(
      Array.from({ length: 5 }, () =>
        post(`/api/conversations/${chat.id}/records`, recordPayload),
      ),
    );
    for (const reply of replies) assert.deepEqual(reply.json(), record);
    assert.equal(
      (await post("/api/works", { ...workPayload, name: "異内容" })).statusCode,
      409,
    );
    assert.equal(
      (
        await post(`/api/conversations/${chat.id}/records`, {
          ...recordPayload,
          body: "異内容",
        })
      ).statusCode,
      409,
    );
    const other = (
      await post(`/api/works/${work.id}/conversations`, {
        requestKey: "chat-other",
      })
    ).json();
    assert.equal(
      (await post(`/api/conversations/${other.id}/records`, recordPayload))
        .statusCode,
      409,
    );
    assert.deepEqual(
      (
        await app.inject({
          url: `/api/conversations/${chat.id}/records`,
          headers,
        })
      ).json(),
      [record],
    );
    assert.deepEqual(
      (
        await app.inject({
          url: `/api/conversations/${other.id}/records`,
          headers,
        })
      ).json(),
      [],
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("別サイト・不正Host・Origin・セッション・入力を拒否し、保存を増やさない", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-craft-"));
  const app = await createApp({ directory, port: 4317 });
  try {
    const session = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    const valid = {
      host: "localhost:4317",
      origin,
      cookie: session.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": session.json().csrfToken,
    };
    for (const headers of [
      { ...valid, host: "attacker.test:4317" },
      { ...valid, origin: "http://attacker.test" },
      { ...valid, origin: undefined },
      { ...valid, cookie: "" },
      { ...valid, "x-csrf-token": "" },
      { ...valid, "sec-fetch-site": "cross-site" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/works",
        headers: Object.fromEntries(
          Object.entries(headers).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        payload: { requestKey: "bad-site", name: "拒否" },
      });
      assert.equal(response.statusCode, 403);
    }
    assert.equal(
      (
        await app.inject({
          url: "/api/session",
          headers: { host: "evil.test" },
        })
      ).statusCode,
      403,
    );
    for (const payload of [
      { requestKey: "bad-input", name: "   " },
      { requestKey: "short", name: "港" },
      { requestKey: "bad-input", name: 123 },
      { requestKey: "bad-input", name: "港", style: "invented" },
    ])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/works",
            headers: valid,
            payload,
          })
        ).statusCode,
        400,
      );
    assert.deepEqual(
      (await app.inject({ url: "/api/works", headers: valid })).json(),
      [],
    );
    const missing = await app.inject({
      method: "POST",
      url: "/api/works/00000000-0000-4000-8000-000000000000/conversations",
      headers: valid,
      payload: { requestKey: "missing-work" },
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLiteが書き込み不能なら保存済みを返さず、復旧後に同じ受付キーで保存できる", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-readonly-"));
  let app = await createApp({ directory, port: 4317 });
  await app.close();
  await chmod(join(directory, "records.sqlite"), 0o400);
  app = await createApp({ directory, port: 4317 });
  const send = async () => {
    const session = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    return app.inject({
      method: "POST",
      url: "/api/works",
      headers: {
        host: "localhost:4317",
        origin,
        cookie: session.headers["set-cookie"]!.toString().split(";")[0],
        "x-csrf-token": session.json().csrfToken,
      },
      payload: { requestKey: "failed-save", name: "保存を試す作品" },
    });
  };
  try {
    const failed = await send();
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(failed.json(), { error: "SAVE_FAILED" });
    assert.deepEqual(
      (
        await app.inject({
          url: "/api/works",
          headers: { host: "localhost:4317" },
        })
      ).json(),
      [],
    );
    await app.close();
    await chmod(join(directory, "records.sqlite"), 0o600);
    app = await createApp({ directory, port: 4317 });
    assert.equal((await send()).statusCode, 200);
    assert.equal(
      (
        await app.inject({
          url: "/api/works",
          headers: { host: "localhost:4317" },
        })
      ).json().length,
      1,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
