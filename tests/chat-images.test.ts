import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { chatFixture } from "./chat-fixture.js";

test("会話画像をLLM入力へ固定し、成果物を増やさず再起動・再開後も同じ画像を参照する", async () => {
  const f = await chatFixture();
  try {
    const bytes = await sharp({
      create: { width: 4, height: 3, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const id = crypto.randomUUID();
    const url = `/api/conversations/${f.chat.id}/images/${id}`;
    const uploaded = await f.upload(`${url}?name=reference.png`, bytes);
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const image = uploaded.json();
    assert.equal(image.id, id);
    assert.equal(image.mime, "image/png");
    assert.equal(image.width, 4);
    const accepted = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "この画像を説明して",
      imageIds: [id],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(accepted.images, [image]);
    const mainTurn = f.calls.find(
      (call) =>
        call.method === "turn/start" &&
        call.params.clientUserMessageId === accepted.id,
    )!;
    assert.equal(mainTurn.params.input[1].type, "localImage");
    assert.deepEqual(await readFile(mainTurn.params.input[1].path), bytes);
    assert.deepEqual((await f.response(url)).rawPayload, bytes);
    assert.deepEqual(
      await f.read(`/api/conversations/${f.chat.id}/records`),
      [],
    );
    await f.restart();
    assert.deepEqual((await f.view()).requests[0].images, [image]);
    assert.deepEqual((await f.response(url)).rawPayload, bytes);
  } finally {
    await f.close();
  }
});

test("画像の同内容再送と形式検査、別会話の拒否、未送信画像の削除を行う", async () => {
  const f = await chatFixture();
  try {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const id = crypto.randomUUID();
    const url = `/api/conversations/${f.chat.id}/images/${id}`;
    assert.equal((await f.upload(`${url}?name=note.png`, png)).statusCode, 200);
    assert.equal((await f.upload(`${url}?name=note.png`, png)).statusCode, 200);
    assert.equal(
      (await f.upload(`${url}?name=note.png`, Buffer.from("not an image")))
        .statusCode,
      400,
    );
    assert.equal((await f.upload(`${url}?name=note.jpg`, png)).statusCode, 400);
    assert.equal((await f.upload(`${url}?name=note.psd`, png)).statusCode, 400);
    assert.equal(
      (
        await f.upload(
          `/api/conversations/${f.chat.id}/images/${crypto.randomUUID()}?name=animated.png`,
          await readFile("tests/fixtures/chat-animated.png"),
        )
      ).statusCode,
      400,
    );
    const other = await f.post(`/api/works/${f.work.id}/conversations`);
    assert.equal(
      (
        await f.raw(`/api/conversations/${other.id}/messages`, {
          requestKey: "foreign-image-key",
          body: "画像",
          imageIds: [id],
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await f.response(`/api/conversations/${other.id}/images/${id}`))
        .statusCode,
      404,
    );
    await f.post(`${url}/remove`);
    assert.equal((await f.response(url)).statusCode, 404);
    for (const format of ["jpeg", "webp"] as const) {
      const bytes = await sharp(png)[format]().toBuffer();
      const uploaded = await f.upload(
        `/api/conversations/${f.chat.id}/images/${crypto.randomUUID()}?name=image.${format}`,
        bytes,
      );
      assert.equal(uploaded.statusCode, 200, uploaded.body);
      assert.equal(uploaded.json().mime, `image/${format}`);
    }
  } finally {
    await f.close();
  }
});

test("画像だけの依頼も送れ、認証復旧後の再開で同じ画像を渡し参照済み画像は削除しない", async () => {
  const f = await chatFixture();
  try {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "green" },
    })
      .png()
      .toBuffer();
    const id = crypto.randomUUID();
    const url = `/api/conversations/${f.chat.id}/images/${id}`;
    const image = (await f.upload(`${url}?name=note.png`, png)).json();
    f.setAuthenticated(false);
    const accepted = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "",
      imageIds: [id],
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal((await f.view()).requests[0].phase, "blocked");
    assert.equal(
      (await f.raw(`${url}/remove`, { requestKey: "remove-used-image" }))
        .statusCode,
      409,
    );
    f.setAuthenticated(true);
    await f.post(`/api/chat-requests/${accepted.id}/resume`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const turn = f.calls.find(
      (call) =>
        call.method === "turn/start" &&
        call.params.clientUserMessageId === accepted.id,
    )!;
    assert.deepEqual(turn.params.input, [
      { type: "localImage", path: turn.params.input[0].path },
    ]);
    assert.deepEqual((await f.view()).requests[0].images, [image]);
  } finally {
    await f.close();
  }
});
