import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";

test("OSで選択した制作ファイルを受け渡し、管理下へ固定して再起動後も開ける", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-attachments-"));
  const source = join(directory, "source"),
    managed = join(directory, "managed");
  await mkdir(source);
  await mkdir(managed);
  const options = {
    directory,
    port: 4317,
    fileRoots: {
      sources: [{ id: "source", path: source }],
      managed: { id: "production", path: managed },
    },
  };
  let app = await createApp(options);
  async function headers() {
    const session = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    return {
      host: "localhost:4317",
      origin: "http://localhost:4317",
      cookie: session.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": session.json().csrfToken,
    };
  }
  async function post(url: string, payload: object) {
    const r = await app.inject({
      method: "POST",
      url,
      payload,
      headers: await headers(),
    });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  }
  try {
    const work = await post("/api/works", {
      requestKey: "attachment-work",
      name: "港",
    });
    const chat = await post(`/api/works/${work.id}/conversations`, {
      requestKey: "attachment-chat",
    });
    const other = await post(`/api/works/${work.id}/conversations`, {
      requestKey: "attachment-other",
    });
    const id = crypto.randomUUID();
    const url = `/api/conversations/${chat.id}/attachments/${id}?name=${encodeURIComponent("空の調整.psd")}`;
    const upload = async (body = "saved Photoshop file") =>
      app.inject({
        method: "POST",
        url,
        payload: Buffer.from(body),
        headers: {
          ...(await headers()),
          "content-type": "application/octet-stream",
        },
      });
    const response = await upload();
    assert.equal(response.statusCode, 200, response.body);
    const attachment = response.json();
    const retry = await upload();
    assert.equal(retry.statusCode, 200, retry.body);
    assert.deepEqual(retry.json(), attachment);
    assert.equal((await upload("changed bytes")).statusCode, 409);
    const invalid = await app.inject({
      method: "POST",
      url: `/api/conversations/${chat.id}/attachments/${crypto.randomUUID()}?name=..%2Fevil.psd`,
      payload: Buffer.from("bad"),
      headers: {
        ...(await headers()),
        "content-type": "application/octet-stream",
      },
    });
    assert.equal(invalid.statusCode, 400);
    const crossChat = await app.inject({
      method: "POST",
      url: `/api/conversations/${other.id}/imports`,
      payload: {
        requestKey: "cross-attachment",
        body: "別会話の添付",
        application: "Photoshop",
        beforeStateId: null,
        files: [attachment.file],
      },
      headers: await headers(),
    });
    assert.equal(crossChat.statusCode, 403);
    const payload = {
      requestKey: "commit-attachment",
      body: "空の色を調整した",
      application: "Photoshop",
      beforeStateId: null,
      files: [attachment.file],
    };
    const result = await post(`/api/conversations/${chat.id}/imports`, payload);
    assert.equal(result.state.files[0].size, 20);
    assert.equal(
      result.state.files[0].source.relativePath.endsWith("空の調整.psd"),
      true,
    );
    await app.close();
    app = await createApp(options);
    assert.deepEqual(
      await post(`/api/conversations/${chat.id}/imports`, payload),
      result,
    );
    const download = await app.inject({
      url: `/api/states/${result.state.id}/files/${result.state.files[0].id}`,
      headers: { host: "localhost:4317" },
    });
    assert.equal(download.statusCode, 200);
    assert.equal(download.body, "saved Photoshop file");
    const unknown = await app.inject({
      method: "POST",
      url: `/api/conversations/${crypto.randomUUID()}/attachments/${crypto.randomUUID()}?name=x.psd`,
      payload: Buffer.from("x"),
      headers: {
        ...(await headers()),
        "content-type": "application/octet-stream",
      },
    });
    assert.equal(unknown.statusCode, 404);
    const tooLarge = await app.inject({
      method: "POST",
      url,
      payload: Buffer.from("x"),
      headers: {
        ...(await headers()),
        "content-type": "application/octet-stream",
        "content-length": String(8 * 1024 ** 3 + 1),
      },
    });
    assert.equal(tooLarge.statusCode, 413);
    const noSession = await app.inject({
      method: "POST",
      url,
      payload: Buffer.from("x"),
      headers: {
        host: "localhost:4317",
        origin: "http://localhost:4317",
        "content-type": "application/octet-stream",
      },
    });
    assert.equal(noSession.statusCode, 403);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
