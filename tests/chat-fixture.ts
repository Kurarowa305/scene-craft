import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/server/app.js";
import { gitFixture, cleanGitFixture } from "./git-fixture.js";
import type { CodexConnection } from "../src/server/codex.js";
import type { FileRoots } from "../src/shared/files.js";
export async function chatFixture(
  external = false,
  withFiles = false,
  referenceFetcher?: import("../src/server/reference-fetch.js").ReferenceFetcher,
  port = 4317,
  staticRoot?: string,
) {
  const directory = await mkdtemp(join(tmpdir(), "chat-fault-"));
  const git = await gitFixture(directory);
  let fileRoots: FileRoots | undefined;
  if (withFiles) {
    const source = join(directory, "source");
    const managed = join(directory, "managed");
    await mkdir(source);
    await mkdir(managed);
    await writeFile(join(source, "drawing.psd"), "saved Photoshop fixture");
    fileRoots = {
      sources: [{ id: "source", path: source }],
      managed: { id: "managed", path: managed },
    };
  }
  const calls: { method: string; params: any }[] = [];
  const listeners = new Set<(method: string, params: any) => void>();
  let hook: ((method: string, params: any) => any) | undefined;
  let authenticated = true;
  const models = ["a", "b"].map((model, index) => ({
    id: model,
    model,
    displayName: model,
    isDefault: index === 0,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [
      { reasoningEffort: "low" },
      { reasoningEffort: "high" },
    ],
  }));
  const codex: CodexConnection = {
    runtime: "fixture-2",
    onEvent(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async close() {},
    async rpc(method, params) {
      calls.push({ method, params });
      const override = await hook?.(method, params);
      if (override !== undefined) return override;
      if (method === "account/read")
        return { account: authenticated ? { type: "chatgpt" } : null };
      if (method === "model/list") return { data: models, nextCursor: null };
      if (method === "thread/start" || method === "thread/resume")
        return {
          thread: { id: "thread-fixture" },
          model: params.model,
          modelProvider: "openai",
        };
      if (method === "turn/start")
        return {
          turn: {
            id: `turn-${calls.filter((c) => c.method === "turn/start").length}`,
            status: "inProgress",
            items: [],
          },
        };
      return {};
    },
  };
  let app = await createApp({
    directory,
    staticRoot,
    referenceFetcher,
    fileRoots,
    port,
    gitRepository: git.repository,
    ...(external
      ? { codexBinary: resolve("tests/fixtures/codex.mjs") }
      : { codex }),
  });
  let headers: Record<string, string> = { host: `localhost:${port}` };
  async function login() {
    const r = await app.inject({
      url: "/api/session",
      headers: { host: `localhost:${port}` },
    });
    headers = {
      host: `localhost:${port}`,
      origin: `http://localhost:${port}`,
      cookie: r.headers["set-cookie"]!.toString().split(";")[0],
      "x-csrf-token": r.json().csrfToken,
    };
  }
  await login();
  let key = 0;
  const raw = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url, headers, payload });
  async function post(url: string, payload: Record<string, unknown> = {}) {
    const r = await raw(url, {
      requestKey: `fixture-key-${++key}`,
      ...payload,
    });
    if (r.statusCode !== 200) throw new Error(r.body);
    return r.json();
  }
  const read = async (url: string) =>
    (await app.inject({ url, headers })).json();
  await post("/api/versions/default", { commit: git.definition });
  const work = await post("/api/works", { name: "試験作品" });
  const chat = await post(`/api/works/${work.id}/conversations`);
  await post(`/api/conversations/${chat.id}/model`, {
    model: external ? "fixture-a" : "a",
    effort: "low",
    speed: "standard",
  });
  return {
    directory,
    closeRuntime: () => app.close(),
    listen: () => app.listen({ host: "127.0.0.1", port }),
    git,
    work,
    chat,
    calls,
    codex,
    post,
    read,
    raw,
    upload: (url: string, bytes: Buffer) =>
      app.inject({
        method: "POST",
        url,
        headers: { ...headers, "content-type": "application/octet-stream" },
        payload: bytes,
      }),
    response: (url: string) => app.inject({ url, headers }),
    setHook(fn: typeof hook) {
      hook = fn;
    },
    setAuthenticated(value: boolean) {
      authenticated = value;
    },
    notify(method: string, params: any) {
      for (const listener of listeners)
        listener(method, { threadId: "thread-fixture", ...params });
    },
    async send() {
      const r = await post(`/api/conversations/${chat.id}/messages`, {
        body: "保持する原文",
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      return r;
    },
    view: () => read(`/api/conversations/${chat.id}/chat`),
    async restart() {
      await app.close();
      app = await createApp({
        directory,
        staticRoot,
        referenceFetcher,
        fileRoots,
        port,
        gitRepository: git.repository,
        ...(external
          ? { codexBinary: resolve("tests/fixtures/codex.mjs") }
          : { codex }),
      });
      await login();
    },
    async close() {
      await app.close();
      await cleanGitFixture(directory);
    },
  };
}
