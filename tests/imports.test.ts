import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/server/app.js";

test("制作ファイルを公開操作で固定し、手修正の前後と原文を再起動後も保つ", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-import-"));
  const source = join(directory, "source");
  const managed = join(directory, "managed");
  await mkdir(source);
  await mkdir(managed);
  await writeFile(join(source, "drawing.psd"), "original");
  let app = await createApp({
    directory,
    port: 4317,
    fileRoots: {
      sources: [{ id: "source", path: source }],
      managed: { id: "production", path: managed },
    },
  });
  async function post(url: string, payload: object) {
    const session = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    const response = await app.inject({
      method: "POST",
      url,
      payload,
      headers: {
        host: "localhost:4317",
        origin: "http://localhost:4317",
        cookie: session.headers["set-cookie"]!.toString().split(";")[0],
        "x-csrf-token": session.json().csrfToken,
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  }
  const get = async (url: string) =>
    (await app.inject({ url, headers: { host: "localhost:4317" } })).json();
  try {
    const work = await post("/api/works", {
      requestKey: "import-work",
      name: "港",
    });
    const chat = await post(`/api/works/${work.id}/conversations`, {
      requestKey: "import-chat",
    });
    const path = `/api/conversations/${chat.id}/imports`;
    const payload = {
      requestKey: "import-first",
      body: "取り込み",
      application: "Photoshop",
      beforeStateId: null,
      files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
    };
    const first = await post(path, payload);
    assert.equal(first.state.beforeStateId, null);
    assert.equal(first.state.historyBeforeImport, "unknown");
    assert.equal(first.state.files[0].rootId, "production");
    assert.equal(first.state.files[0].size, 8);
    assert.equal(
      first.state.files[0].sha256,
      "0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5",
    );
    await writeFile(join(source, "drawing.psd"), "retouched");
    const next = await post(path, {
      ...payload,
      requestKey: "import-second",
      body: " 明るくした\n",
      reason: "夕方らしく",
      beforeStateId: first.state.id,
    });
    assert.equal(next.state.beforeStateId, first.state.id);
    assert.equal(next.state.changeKind, "manual");
    assert.equal(next.state.reason, "夕方らしく");
    assert.equal(
      await readFile(join(managed, first.state.files[0].relativePath), "utf8"),
      "original",
    );
    assert.equal(
      await readFile(join(managed, next.state.files[0].relativePath), "utf8"),
      "retouched",
    );
    await app.close();
    app = await createApp({
      directory,
      port: 4317,
      fileRoots: {
        sources: [{ id: "source", path: source }],
        managed: { id: "production", path: managed },
      },
    });
    assert.deepEqual(await post(path, payload), first);
    const states = await get(`/api/works/${work.id}/states`);
    assert.deepEqual(states.states, [first.state, next.state]);
    assert.equal(states.currentStateId, next.state.id);
    assert.equal(
      (await get(`/api/conversations/${chat.id}/records`))[1].body,
      " 明るくした\n\n夕方らしく",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("再帰依存の循環・不足を表示し、ルート逸脱と本体コピー失敗では現在状態を変えない", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, "scene.blend"), "scene");
    await writeFile(join(f.source, "linked.blend"), "linked");
    await writeFile(
      join(f.source, "scene.blend.scene-craft-dependencies.json"),
      JSON.stringify([{ rootId: "source", relativePath: "linked.blend" }]),
    );
    await writeFile(
      join(f.source, "linked.blend.scene-craft-dependencies.json"),
      JSON.stringify([
        { rootId: "source", relativePath: "scene.blend" },
        { rootId: "source", relativePath: "lost.png" },
      ]),
    );
    const result = await f.post({
      requestKey: "dependencies",
      body: "既存のシーン",
      application: "Blender",
      beforeStateId: null,
      files: [{ rootId: "source", relativePath: "scene.blend", role: "blend" }],
    });
    assert.equal(result.statusCode, 200, result.body);
    const state = result.json().state;
    assert.equal(state.files.length, 2);
    assert.deepEqual(
      new Set(state.missing.map((m: { reason: string }) => m.reason)),
      new Set(["cycle", "not_found", "inspection_pending"]),
    );
    const { symlink } = await import("node:fs/promises");
    await writeFile(join(f.directory, "secret.psd"), "secret");
    await symlink(
      join(f.directory, "secret.psd"),
      join(f.source, "escape.psd"),
    );
    for (const [index, path] of [
      "../secret.psd",
      "escape.psd",
      "missing.psd",
    ].entries()) {
      const failed = await f.post({
        requestKey: "bad-copy-" + index,
        body: "失敗",
        application: "Photoshop",
        beforeStateId: state.id,
        files: [{ rootId: "source", relativePath: path, role: "psd" }],
      });
      assert.ok([400, 409, 500].includes(failed.statusCode), failed.body);
    }
    assert.deepEqual((await f.get(`/api/works/${f.work.id}/states`)).states, [
      state,
    ]);
    const operations = await f.get(`/api/works/${f.work.id}/imports`);
    assert.equal(operations[1].phase, "incomplete");
    assert.equal(
      (await f.get(`/api/conversations/${f.chat.id}/records`)).length,
      1,
    );
  } finally {
    await f.close();
  }
});

async function fixture(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "scene-files-"));
  const source = join(directory, "source");
  const managed = join(directory, "managed");
  await mkdir(source);
  await mkdir(managed);
  const options = {
    directory,
    port: 4317,
    fileRoots: {
      sources: [{ id: "source", path: source }],
      managed: { id: "production", path: managed },
    },
    ...extra,
  };
  let app = await createApp(options);
  const get = async (url: string) =>
    (await app.inject({ url, headers: { host: "localhost:4317" } })).json();
  async function send(url: string, payload: object) {
    const session = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    return app.inject({
      method: "POST",
      url,
      payload,
      headers: {
        host: "localhost:4317",
        origin: "http://localhost:4317",
        cookie: session.headers["set-cookie"]!.toString().split(";")[0],
        "x-csrf-token": session.json().csrfToken,
      },
    });
  }
  const work = (
    await send("/api/works", { requestKey: "fixture-work", name: "港" })
  ).json();
  const chat = (
    await send(`/api/works/${work.id}/conversations`, {
      requestKey: "fixture-chat",
    })
  ).json();
  return {
    directory,
    source,
    managed,
    work,
    chat,
    get,
    send,
    post: (payload: object) =>
      send(`/api/conversations/${chat.id}/imports`, payload),
    restart: async () => {
      await app.close();
      app = await createApp(options);
    },
    close: async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("実体確定後のDB失敗を完成記録から照合し、同時再送・応答喪失でも一度だけ確定する", async () => {
  const { rename } = await import("node:fs/promises");
  const { DatabaseSync } = await import("node:sqlite");
  let blocker: InstanceType<typeof DatabaseSync> | undefined;
  let directory = "";
  let fail = true;
  const f = await fixture({
    publishFiles: async (from, to) => {
      await rename(from, to);
      if (fail) {
        fail = false;
        blocker = new DatabaseSync(join(directory, "records.sqlite"));
        blocker.exec("BEGIN IMMEDIATE");
      }
    },
  });
  directory = f.directory;
  try {
    await writeFile(join(f.source, "drawing.psd"), "fixed");
    const payload = {
      requestKey: "database-failure",
      body: "保存",
      application: "Photoshop",
      beforeStateId: null,
      files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
    };
    const failed = await f.post(payload);
    assert.equal(failed.statusCode, 500);
    blocker!.exec("ROLLBACK");
    blocker!.close();
    blocker = undefined;
    assert.equal(
      (await f.get(`/api/works/${f.work.id}/states`)).states.length,
      0,
    );
    // Original may be unavailable after restart: reconciliation must use verified fixed files.
    await rm(join(f.source, "drawing.psd"));
    await f.restart();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => f.post(payload)),
    );
    for (const response of results)
      assert.equal(response.statusCode, 200, response.body);
    for (const response of results)
      assert.deepEqual(response.json(), results[0]!.json());
    assert.equal(
      (await f.get(`/api/works/${f.work.id}/states`)).states.length,
      1,
    );
    assert.equal(
      (await f.get(`/api/conversations/${f.chat.id}/records`)).length,
      1,
    );
    assert.equal(
      (await f.post({ ...payload, body: "異内容" })).statusCode,
      409,
    );
  } finally {
    if (blocker) {
      blocker.exec("ROLLBACK");
      blocker.close();
    }
    await f.close();
  }
});

test("コピー中に変わった入力は未完成のまま保持し、同じキーで再試行または明示中止できる", async () => {
  let change = true;
  const f = await fixture({
    dependencyInspector: async (_source, path) => {
      if (change) {
        change = false;
        await writeFile(path, "changed during collection");
      }
      return { dependencies: [], verified: false };
    },
  });
  try {
    await writeFile(join(f.source, "scene.blend"), "original");
    const payload = {
      requestKey: "changed-source",
      body: "保存を試す",
      application: "Blender",
      beforeStateId: null,
      files: [{ rootId: "source", relativePath: "scene.blend", role: "blend" }],
    };
    assert.equal((await f.post(payload)).statusCode, 409);
    assert.equal(
      (await f.get(`/api/works/${f.work.id}/states`)).states.length,
      0,
    );
    const operation = (await f.get(`/api/works/${f.work.id}/imports`))[0];
    assert.equal(operation.error, "SOURCE_CHANGED");
    assert.equal(
      (
        await f.send(`/api/imports/${operation.id}/abandon`, {
          requestKey: "abandon-operation",
        })
      ).statusCode,
      200,
    );
    const result = await f.post({ ...payload, requestKey: "next-valid-save" });
    assert.equal(result.statusCode, 200, result.body);
  } finally {
    await f.close();
  }
});

test("外部を指すリンク・相対ルート逸脱を個別に拒否し、未完成を中止して再入力できる", async () => {
  const { symlink } = await import("node:fs/promises");
  const f = await fixture();
  try {
    await writeFile(join(f.directory, "outside.psd"), "private");
    await symlink(
      join(f.directory, "outside.psd"),
      join(f.source, "escape.psd"),
    );
    for (const [index, path] of [
      "../outside.psd",
      "escape.psd",
      "missing.psd",
    ].entries()) {
      const payload = {
        requestKey: "reject-source-" + index,
        body: "拒否される入力",
        application: "Photoshop",
        beforeStateId: null,
        files: [{ rootId: "source", relativePath: path, role: "psd" }],
      };
      const response = await f.post(payload);
      assert.equal(
        response.statusCode,
        path === "missing.psd" ? 500 : 400,
        response.body,
      );
      const ops = await f.get(`/api/works/${f.work.id}/imports`);
      assert.equal(ops[index].phase, "incomplete");
      assert.equal(
        (
          await f.send(`/api/imports/${ops[index].id}/abandon`, {
            requestKey: "abandon-invalid-" + index,
          })
        ).statusCode,
        200,
      );
    }
    assert.equal(
      (await f.get(`/api/works/${f.work.id}/states`)).states.length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("元レンダー・保存状態の所属を検査し、Photoshopの手修正でblendとレンダーの固定参照を保持する", async () => {
  const f = await fixture();
  try {
    for (const path of ["scene.blend", "drawing.psd", "render.png"])
      await writeFile(join(f.source, path), path);
    const first = (
      await f.post({
        requestKey: "combined-first",
        body: "取り込み",
        application: "Blender",
        beforeStateId: null,
        files: [
          { rootId: "source", relativePath: "scene.blend", role: "blend" },
          { rootId: "source", relativePath: "render.png", role: "render" },
        ],
      })
    ).json();
    const renderer = first.state.files.find(
      (file: { role: string }) => file.role === "render",
    );
    const payload = {
      requestKey: "photoshop-next",
      body: "レタッチ",
      application: "Photoshop",
      beforeStateId: first.state.id,
      render: { stateId: first.state.id, fileId: renderer.id },
      files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
    };
    const result = await f.post(payload);
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(result.json().state.render, payload.render);
    assert.equal(
      result
        .json()
        .state.files.find((file: { role: string }) => file.role === "blend").id,
      first.state.files[0].id,
    );
    assert.equal(result.json().state.reason, null);
    const other = (
      await f.send("/api/works", {
        requestKey: "another-work",
        name: "別の作品",
      })
    ).json();
    const chat = (
      await f.send(`/api/works/${other.id}/conversations`, {
        requestKey: "another-chat",
      })
    ).json();
    assert.equal(
      (
        await f.send(`/api/conversations/${chat.id}/imports`, {
          ...payload,
          requestKey: "cross-work-render",
          beforeStateId: null,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await f.post({ ...payload, requestKey: "stale-before-state" }))
        .statusCode,
      409,
    );
  } finally {
    await f.close();
  }
});

test("完成実体が破損した照合待ちを成功や中止にせず、現在状態と原文を保持する", async () => {
  const { rename, readdir, chmod } = await import("node:fs/promises");
  let lost = true;
  const f = await fixture({
    publishFiles: async (from, to) => {
      await rename(from, to);
      if (lost) {
        lost = false;
        throw new Error("lost publication response");
      }
    },
  });
  try {
    await writeFile(join(f.source, "drawing.psd"), "expected content");
    const payload = {
      requestKey: "damaged-completion",
      body: "確定前",
      application: "Photoshop",
      beforeStateId: null,
      files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
    };
    assert.equal((await f.post(payload)).statusCode, 500);
    const op = (await f.get(`/api/works/${f.work.id}/imports`))[0];
    const directory = join(f.managed, op.id);
    const data = (await readdir(directory)).find((file) =>
      file.endsWith(".psd"),
    )!;
    await chmod(join(directory, data), 0o600);
    await writeFile(join(directory, data), "corrupt");
    await f.restart();
    assert.equal((await f.post(payload)).statusCode, 409);
    assert.equal(
      (
        await f.send(`/api/imports/${op.id}/abandon`, {
          requestKey: "cannot-abandon-completed",
        })
      ).statusCode,
      409,
    );
    assert.deepEqual(await f.get(`/api/works/${f.work.id}/states`), {
      currentStateId: null,
      states: [],
    });
    assert.deepEqual(
      await f.get(`/api/conversations/${f.chat.id}/records`),
      [],
    );
    assert.equal(
      (await f.get(`/api/works/${f.work.id}/imports`))[0].error,
      "FIXED_FILE_CORRUPT",
    );
  } finally {
    await f.close();
  }
});

test("blendを保持してPhotoshopを手修正しても依存不足を履歴から落とさず、同内容のキー順変更を受け付ける", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.source, "scene.blend"), "scene");
    await writeFile(join(f.source, "drawing.psd"), "drawing");
    await writeFile(
      join(f.source, "scene.blend.scene-craft-dependencies.json"),
      JSON.stringify([{ rootId: "source", relativePath: "lost.png" }]),
    );
    const first = (
      await f.post({
        requestKey: "retain-missing",
        body: "最初",
        application: "Blender",
        beforeStateId: null,
        files: [
          { rootId: "source", relativePath: "scene.blend", role: "blend" },
        ],
      })
    ).json();
    const next = {
      requestKey: "retouch-with-missing",
      body: "PSDを調整",
      application: "Photoshop",
      beforeStateId: first.state.id,
      files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
    };
    const result = await f.post(next);
    assert.equal(result.statusCode, 200, result.body);
    assert.ok(
      result
        .json()
        .state.missing.some(
          (item: { reason: string }) => item.reason === "not_found",
        ),
    );
    const replay = await f.post({
      files: [{ role: "psd", relativePath: "drawing.psd", rootId: "source" }],
      beforeStateId: first.state.id,
      application: "Photoshop",
      body: "PSDを調整",
      requestKey: "retouch-with-missing",
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), result.json());
  } finally {
    await f.close();
  }
});

test("完成記録の構成・理由が変わっていたらDBの予定と不一致として照合を止める", async () => {
  const { rename, chmod } = await import("node:fs/promises");
  let fail = false;
  const f = await fixture({
    publishFiles: async (from, to) => {
      await rename(from, to);
      if (fail) throw new Error("lost response");
    },
  });
  try {
    await writeFile(join(f.source, "scene.blend"), "scene");
    await writeFile(join(f.source, "drawing.psd"), "drawing");
    const first = (
      await f.post({
        requestKey: "metadata-first",
        body: "取り込み",
        application: "Blender",
        beforeStateId: null,
        files: [
          { rootId: "source", relativePath: "scene.blend", role: "blend" },
        ],
      })
    ).json();
    const payload = {
      requestKey: "metadata-second",
      body: "手修正",
      reason: "本来の理由",
      application: "Photoshop",
      beforeStateId: first.state.id,
      files: [{ rootId: "source", relativePath: "drawing.psd", role: "psd" }],
    };
    fail = true;
    assert.equal((await f.post(payload)).statusCode, 500);
    const op = (await f.get(`/api/works/${f.work.id}/imports`))[1];
    const path = join(f.managed, op.id, "complete.json");
    const marker = JSON.parse(await readFile(path, "utf8"));
    marker.state.reason = "異なる理由";
    marker.state.files = marker.state.files.filter(
      (file: { role: string }) => file.role !== "blend",
    );
    await chmod(path, 0o600);
    await writeFile(path, JSON.stringify(marker));
    assert.equal((await f.post(payload)).statusCode, 409);
    assert.equal(
      (await f.get(`/api/works/${f.work.id}/states`)).states.length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("依存列挙の根拠ファイルが収集中に変わったら未完成とし、依存集合を固定しない", async () => {
  const { createHash } = await import("node:crypto");
  const f = await fixture({
    dependencyInspector: async (source, path) => {
      const bytes = await readFile(path + ".scene-craft-dependencies.json");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(path + ".scene-craft-dependencies.json", "[]");
      return {
        dependencies: [],
        verified: false,
        observedInputs: [
          {
            source: {
              rootId: source.rootId,
              relativePath:
                source.relativePath + ".scene-craft-dependencies.json",
            },
            size: bytes.length,
            sha256,
          },
        ],
      };
    },
  });
  try {
    await writeFile(join(f.source, "scene.blend"), "scene");
    await writeFile(
      join(f.source, "scene.blend.scene-craft-dependencies.json"),
      "[ ]",
    );
    const result = await f.post({
      requestKey: "manifest-changed",
      body: "依存を取り込む",
      application: "Blender",
      beforeStateId: null,
      files: [{ rootId: "source", relativePath: "scene.blend", role: "blend" }],
    });
    assert.equal(result.statusCode, 409, result.body);
    assert.equal(
      (await f.get(`/api/works/${f.work.id}/states`)).states.length,
      0,
    );
    assert.equal(
      (await f.get(`/api/works/${f.work.id}/imports`))[0].error,
      "SOURCE_CHANGED",
    );
  } finally {
    await f.close();
  }
});
