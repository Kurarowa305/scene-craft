import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  chmod,
  readdir,
  unlink,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { DatabaseSync } from "node:sqlite";
import {
  gitFixture,
  cleanGitFixture,
  definitionManifest,
} from "./git-fixture.js";

async function clean(directory: string) {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await clean(join(directory, entry.name));
  await rm(directory, { recursive: true, force: true });
}

test("定義の既定版と別コミットの作風を固定し、再送と再起動で保持する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-versions-"));
  const repository = join(directory, "repo");
  await mkdir(repository);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
    }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  await writeFile(join(repository, "instructions.md"), "固定された指示");
  await writeFile(
    join(repository, "definition.json"),
    JSON.stringify({
      schema: "scene-craft.definition.v1",
      runtime: "scene-craft.v1",
      roles: [
        {
          id: "reference",
          description: "参考調査",
          instructions: ["instructions.md"],
          procedures: [],
          code: [],
          context: ["work.intent"],
          tools: [],
          operations: [],
          outputs: ["text"],
        },
      ],
      style: { required: false, formats: ["scene-craft.style.v1"] },
    }),
  );
  git("add", ".");
  git("commit", "-m", "definition");
  const definition = git("rev-parse", "HEAD");
  await writeFile(
    join(repository, "style.json"),
    JSON.stringify({
      schema: "scene-craft.style.v1",
      tendencies: ["静けさ"],
      policies: ["余白を残す"],
    }),
  );
  git("add", ".");
  git("commit", "-m", "style");
  const style = git("rev-parse", "HEAD");
  await writeFile(join(repository, "instructions.md"), "未コミットの指示");
  let app = await createApp({
    directory,
    port: 4317,
    gitRepository: repository,
  });
  const login = async () => {
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
  };
  let headers = await login();
  const post = async (url: string, payload: Record<string, unknown>) => {
    const response = await app.inject({
      method: "POST",
      url,
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  try {
    const settings = await post("/api/versions/default", {
      requestKey: "default-0001",
      commit: definition,
    });
    assert.equal(settings.definition.commit, definition);
    assert.equal(
      settings.definition.files.find(
        (f: { path: string }) => f.path === "instructions.md",
      ).blob,
      git("rev-parse", `${definition}:instructions.md`),
    );
    const input = {
      requestKey: "work-version-001",
      name: "港",
      styleCommit: style,
    };
    const work = await post("/api/works", input);
    assert.equal(work.style.commit, style);
    assert.equal(work.plannedDefinition.commit, definition);
    await post("/api/versions/default", {
      requestKey: "default-0002",
      commit: style,
    });
    assert.deepEqual(await post("/api/works", input), work);
    assert.equal(
      git("rev-parse", `refs/tags/scene-craft/retained/${definition}`),
      definition,
    );
    await app.close();
    app = await createApp({ directory, port: 4317, gitRepository: repository });
    headers = await login();
    const status = await app.inject({
      url: `/api/works/${work.id}/versions`,
      headers,
    });
    assert.equal(status.json().definition.commit, style);
    assert.equal(status.json().style.commit, work.style.commit);
    assert.equal(status.json().availability.available, true);
  } finally {
    await app.close();
    await clean(directory);
  }
});

test("欠損・非互換は実行用参照の固定を止め、履歴と手作業記録は継続できる", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-git-unavailable-"));
  const f = await gitFixture(directory);
  const app = await createApp({
    directory,
    port: 4317,
    gitRepository: f.repository,
  });
  try {
    const s = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    const headers = {
      host: "localhost:4317",
      origin: "http://localhost:4317",
      cookie: s.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": s.json().csrfToken,
    };
    const post = (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url, headers, payload });
    await post("/api/versions/default", {
      requestKey: "unavailable-default",
      commit: f.definition,
    });
    const work = (
      await post("/api/works", {
        requestKey: "unavailable-work",
        name: "手作業を続ける",
      })
    ).json();
    const conversation = (
      await post(`/api/works/${work.id}/conversations`, {
        requestKey: "unavailable-chat",
      })
    ).json();
    await writeFile(
      join(f.repository, "definition.json"),
      JSON.stringify({ ...definitionManifest, runtime: "unknown" }),
    );
    f.git("add", ".");
    f.git("commit", "-m", "incompatible");
    let response = await post("/api/versions/default", {
      requestKey: "unavailable-bad",
      commit: f.git("rev-parse", "HEAD"),
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "GIT_RUNTIME_INCOMPATIBLE");
    // The export contains committed bytes, not workspace modifications, and is read-only.
    const exports = await readdir(join(directory, "git-exports"));
    const exported = join(directory, "git-exports", exports[0]);
    assert.equal(
      await readFile(join(exported, "instructions.md"), "utf8"),
      "固定された指示",
    );
    assert.equal((await stat(exported)).mode & 0o222, 0);
    assert.equal(
      (await stat(join(exported, "instructions.md"))).mode & 0o222,
      0,
    );
    const blob = f.git("rev-parse", `${f.definition}:instructions.md`);
    await unlink(
      join(f.repository, ".git", "objects", blob.slice(0, 2), blob.slice(2)),
    );
    const status = (
      await app.inject({ url: `/api/works/${work.id}/versions`, headers })
    ).json();
    assert.equal(status.availability.available, false);
    assert.equal(status.definition.commit, f.definition);
    response = await post(`/api/works/${work.id}/version-plans`, {
      requestKey: "unavailable-plan",
    });
    assert.equal(response.statusCode, 409);
    response = await post(`/api/conversations/${conversation.id}/records`, {
      requestKey: "unavailable-record",
      body: "Git欠損中も記録する",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      (
        await app.inject({
          url: `/api/conversations/${conversation.id}/records`,
          headers,
        })
      ).json()[0].body,
      "Git欠損中も記録する",
    );
  } finally {
    await app.close();
    await cleanGitFixture(directory);
  }
});

test("新規依頼用の参照を一度だけ固定し、既定変更とGC後も内容を読み出す", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-git-plan-"));
  const f = await gitFixture(directory);
  const app = await createApp({
    directory,
    port: 4317,
    gitRepository: f.repository,
  });
  try {
    const s = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    const headers = {
      host: "localhost:4317",
      origin: "http://localhost:4317",
      cookie: s.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": s.json().csrfToken,
    };
    const post = async (url: string, payload: Record<string, unknown>) => {
      const r = await app.inject({ method: "POST", url, headers, payload });
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    await post("/api/versions/default", {
      requestKey: "plan-default-001",
      commit: f.definition,
    });
    const work = await post("/api/works", {
      requestKey: "plan-work-001",
      name: "港",
      styleCommit: f.style,
    });
    const url = `/api/works/${work.id}/version-plans`;
    const plan = await post(url, { requestKey: "plan-request-001" });
    assert.equal(plan.definition.commit, f.definition);
    assert.equal(plan.style.commit, f.style);
    await post("/api/versions/default", {
      requestKey: "plan-default-002",
      commit: f.style,
    });
    assert.deepEqual(await post(url, { requestKey: "plan-request-001" }), plan);
    // Both commits now survive only through retention tags.
    f.git("checkout", "--orphan", "unrelated");
    f.git("rm", "-rf", ".");
    await writeFile(join(f.repository, "unrelated"), "unrelated");
    f.git("add", ".");
    f.git("commit", "-m", "unrelated");
    f.git("branch", "-D", "main");
    f.git("reflog", "expire", "--expire=now", "--all");
    f.git("gc", "--prune=now");
    const content = await app.inject({
      url: `/api/version-plans/${plan.id}/content?kind=definition&path=instructions.md`,
      headers,
    });
    assert.equal(content.statusCode, 200, content.body);
    assert.equal(content.json().content, "固定された指示");
    const plans = (await app.inject({ url, headers })).json();
    assert.deepEqual(plans, [plan]);
  } finally {
    await app.close();
    await cleanGitFixture(directory);
  }
});

test("保持タグ競合とsymbolic refを拒否し、以前の選択を維持する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-git-conflict-"));
  const f = await gitFixture(directory);
  const app = await createApp({
    directory,
    port: 4317,
    gitRepository: f.repository,
  });
  try {
    const s = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    const headers = {
      host: "localhost:4317",
      origin: "http://localhost:4317",
      cookie: s.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": s.json().csrfToken,
    };
    const select = (commit: string, key: string) =>
      app.inject({
        method: "POST",
        url: "/api/versions/default",
        headers,
        payload: { requestKey: key, commit },
      });
    assert.equal((await select(f.definition, "default-good")).statusCode, 200);
    const tag = `refs/tags/scene-craft/retained/${f.style}`;
    f.git("update-ref", tag, f.definition);
    let result = await select(f.style, "conflict-001");
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().error, "GIT_TAG_CONFLICT");
    assert.equal(f.git("rev-parse", tag), f.definition);
    f.git("update-ref", "-d", tag);
    f.git("symbolic-ref", tag, "refs/heads/missing");
    result = await select(f.style, "symbolic-001");
    assert.equal(result.statusCode, 409);
    assert.equal(f.git("symbolic-ref", tag), "refs/heads/missing");
    assert.equal(
      (await app.inject({ url: "/api/versions", headers })).json().definition
        .commit,
      f.definition,
    );
  } finally {
    await app.close();
    await cleanGitFixture(directory);
  }
});

test("DB確定失敗でも保持タグを残し、同じ受付で安全に再送できる", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-git-db-"));
  const f = await gitFixture(directory);
  const app = await createApp({
    directory,
    port: 4317,
    gitRepository: f.repository,
  });
  const db = new DatabaseSync(join(directory, "records.sqlite"));
  try {
    const s = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    const headers = {
      host: "localhost:4317",
      origin: "http://localhost:4317",
      cookie: s.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": s.json().csrfToken,
    };
    db.exec(
      "CREATE TRIGGER fail_git_settings BEFORE INSERT ON git_settings BEGIN SELECT RAISE(ABORT, 'disk failure'); END;",
    );
    const send = () =>
      app.inject({
        method: "POST",
        url: "/api/versions/default",
        headers,
        payload: { requestKey: "db-failure-001", commit: f.definition },
      });
    assert.equal((await send()).statusCode, 500);
    assert.equal(
      f.git("rev-parse", `refs/tags/scene-craft/retained/${f.definition}`),
      f.definition,
    );
    assert.equal(
      (await app.inject({ url: "/api/versions", headers })).json().definition,
      null,
    );
    db.exec("DROP TRIGGER fail_git_settings");
    assert.equal((await send()).statusCode, 200);
    assert.equal(
      (await app.inject({ url: "/api/versions", headers })).json().definition
        .commit,
      f.definition,
    );
  } finally {
    db.close();
    await app.close();
    await cleanGitFixture(directory);
  }
});

test("未対応の契約・不正なmanifest・外部リンクを保持完了として扱わない", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scene-git-contract-"));
  const f = await gitFixture(directory);
  const app = await createApp({
    directory,
    port: 4317,
    gitRepository: f.repository,
  });
  try {
    const s = await app.inject({
      url: "/api/session",
      headers: { host: "localhost:4317" },
    });
    const headers = {
      host: "localhost:4317",
      origin: "http://localhost:4317",
      cookie: s.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": s.json().csrfToken,
    };
    const scenarios = [
      {
        manifest: {
          ...definitionManifest,
          roles: [{ ...definitionManifest.roles[0], tools: ["shell"] }],
        },
        error: "GIT_TOOL_CONTRACT_INCOMPATIBLE",
      },
      {
        manifest: {
          ...definitionManifest,
          roles: [{ ...definitionManifest.roles[0], outputs: [] }],
        },
        error: "GIT_MANIFEST_INVALID",
      },
      {
        manifest: {
          ...definitionManifest,
          roles: [
            { ...definitionManifest.roles[0], instructions: ["../outside.md"] },
          ],
        },
        error: "GIT_PATH_INVALID",
      },
      {
        manifest: {
          ...definitionManifest,
          roles: [{ ...definitionManifest.roles[0], code: ["missing.py"] }],
        },
        error: "GIT_DEPENDENCY_UNRESOLVED",
      },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      await writeFile(
        join(f.repository, "definition.json"),
        JSON.stringify(scenario.manifest),
      );
      f.git("add", ".");
      f.git("commit", "-m", `invalid ${index}`);
      const response = await app.inject({
        method: "POST",
        url: "/api/versions/default",
        headers,
        payload: {
          requestKey: `invalid-contract-${index}`,
          commit: f.git("rev-parse", "HEAD"),
        },
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().error, scenario.error);
    }
    await writeFile(
      join(f.repository, "definition.json"),
      JSON.stringify(definitionManifest),
    );
    await writeFile(join(f.repository, "instructions.md"), "/outside.md");
    f.git("add", ".");
    const blob = f.git("rev-parse", ":instructions.md");
    f.git("update-index", "--cacheinfo", `120000,${blob},instructions.md`);
    f.git("commit", "-m", "symlink");
    const response = await app.inject({
      method: "POST",
      url: "/api/versions/default",
      headers,
      payload: {
        requestKey: "invalid-symlink",
        commit: f.git("rev-parse", "HEAD"),
      },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "GIT_DEPENDENCY_UNRESOLVED");
    assert.equal(
      (await app.inject({ url: "/api/versions", headers })).json().definition,
      null,
    );
  } finally {
    await app.close();
    await cleanGitFixture(directory);
  }
});
