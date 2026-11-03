import { sendRecord } from "./ui-helpers";
import {
  openWorkDialog,
  openSettings,
  choosePanel,
  openArtifacts,
  openChatUtilities,
} from "./ui-helpers";
import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../../src/server/app.js";
import { gitFixture, cleanGitFixture } from "../git-fixture.js";

test.use({ baseURL: "http://localhost:4519" });
let app: Awaited<ReturnType<typeof createApp>>;
let directory: string;
let definition: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "side-browser-"));
  const git = await gitFixture(directory);
  definition = git.definition;
  const source = join(directory, "source"),
    managed = join(directory, "managed");
  await mkdir(source);
  await mkdir(managed);
  await writeFile(join(source, "drawing.psd"), "browser saved file fixture");
  await chmod("tests/fixtures/codex.mjs", 0o700);
  app = await createApp({
    directory,
    port: 4519,
    gitRepository: git.repository,
    codexBinary: resolve("tests/fixtures/codex.mjs"),
    staticRoot: resolve("dist/client"),
    fileRoots: {
      sources: [{ id: "source", path: source }],
      managed: { id: "production", path: managed },
    },
  });
  await app.listen({ host: "127.0.0.1", port: 4519 });
});
test.afterAll(async () => {
  await app?.close();
  if (directory) await cleanGitFixture(directory);
});

async function createMain(page: import("@playwright/test").Page, name: string) {
  await openSettings(page);
  await page.getByLabel("定義のフルコミット").fill(definition);
  await page
    .getByRole("button", { name: "既定定義を保存", exact: true })
    .click();
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill(name);
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page.getByRole("button", { name: `${name}に新しいチャット` }).click();
}

test("保存済みサイドが8件あってもメインのAPI要求を妨げない", async ({
  page,
}) => {
  const session = await (await page.request.get("/api/session")).json();
  const headers = {
    origin: "http://localhost:4519",
    "x-csrf-token": session.csrfToken,
  };
  const post = async (path: string, body = {}) => {
    const response = await page.request.post(path, {
      headers,
      data: { requestKey: crypto.randomUUID(), ...body },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  await post("/api/versions/default", { commit: definition });
  const work = await post("/api/works", { name: "相談8件の作品" });
  const main = await post(`/api/works/${work.id}/conversations`);
  for (let i = 0; i < 8; i++)
    await post(`/api/conversations/${main.id}/side-chats`, {
      selectedStateIds: [],
    });
  await page.goto("/");
  await page
    .getByRole("button", { name: "相談8件の作品", exact: true })
    .click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await choosePanel(page, "サイドチャット");
  await expect(
    page.getByRole("button", { name: /^相談を再表示:/ }),
  ).toHaveCount(8);
  expect(
    await page.evaluate(
      async () =>
        (await fetch("/api/works", { signal: AbortSignal.timeout(2000) }))
          .status,
    ),
  ).toBe(200);
});

test("遅い相談一覧を受信しても新しく作った相談を失わない", async ({ page }) => {
  await page.goto("/");
  let release = () => {},
    fetched = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  await page.route("**/api/conversations/*/side-chats", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response });
  });
  await createMain(page, "相談一覧遅延");
  await ready;
  await choosePanel(page, "サイドチャット");
  const panel = page.getByRole("complementary", { name: "右側タブ" });
  await expect(panel.getByLabel("メインの話題")).toHaveCount(0);
  await panel.getByRole("button", { name: "相談を開始", exact: true }).click();
  await expect(
    panel.getByRole("tab", { name: "未命名のサイドチャット 1", exact: true }),
  ).toBeVisible();
  release();
  await panel
    .getByRole("button", {
      name: "未命名のサイドチャット 1を閉じる",
      exact: true,
    })
    .click();
  await choosePanel(page, "サイドチャット");
  await expect(
    panel.getByRole("button", {
      name: "相談を再表示: 未命名のサイドチャット 1",
      exact: true,
    }),
  ).toBeVisible();
});

test("右タブの相談を閉じても継続し、再表示・停止・再読み込みで原文を保持する", async ({
  page,
}) => {
  await page.goto("/");
  await createMain(page, "サイド確認");
  const main = page.getByRole("region", { name: "Codexとの会話", exact: true });
  const panel = page.getByRole("complementary", { name: "右側タブ" });
  await main
    .getByLabel("会話モデル", { exact: true })
    .selectOption("fixture-a");
  await openChatUtilities(page);
  await main.getByText("保存用要約・根拠・補助モデル", { exact: true }).click();
  await main
    .getByLabel("命名・要約モデル", { exact: true })
    .selectOption("fixture-a");
  await page.getByRole("button", { name: "成果物・ファイルを添付" }).click();
  await page
    .getByRole("button", {
      name: "コンピューターからファイルを添付",
      exact: true,
    })
    .click();
  await page
    .getByLabel("コンピューターからファイルを選択", { exact: true })
    .setInputFiles({
      name: "drawing.psd",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("saved file fixture"),
    });
  await expect(page.getByText("drawing.psd", { exact: true })).toBeVisible();
  await main
    .getByLabel("メッセージ", { exact: true })
    .fill("相談開始直前の成果物");
  await sendRecord(page);
  await openArtifacts(page);
  await panel.getByRole("button", { name: /drawing.psd.*Photoshop/ }).click();
  await choosePanel(page, "サイドチャット");
  await expect(panel.getByLabel("メインの話題")).toHaveCount(0);
  await main.getByLabel("メッセージ", { exact: true }).fill("メインの制作相談");
  await main.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await panel.getByRole("button", { name: "相談を開始", exact: true }).click();
  const side = panel.getByRole("region", { name: "サイドチャットの会話" });
  await expect(side.getByLabel("会話モデル", { exact: true })).toHaveValue(
    "fixture-a",
  );
  await expect(side.getByLabel("エージェント", { exact: true })).toHaveCount(0);
  await expect(
    side.getByRole("button", { name: "記録として送信", exact: true }),
  ).toHaveCount(0);
  await side
    .getByLabel("サイドチャットのメッセージ", { exact: true })
    .fill("ライトを調整する操作を教えて");
  await side.getByRole("button", { name: "相談を送信", exact: true }).click();
  await expect(side.getByText("応答中", { exact: true })).toBeVisible();
  await panel
    .getByRole("button", {
      name: /未命名のサイドチャット 1を閉じる|港の光の検討を閉じる/,
      exact: true,
    })
    .click();
  await choosePanel(page, "サイドチャット");
  await panel
    .getByRole("button", { name: "相談を再表示: 港の光の検討", exact: true })
    .click();
  await expect(side.getByText("保存される返答", { exact: true })).toBeVisible();
  await expect(
    side.getByText("ライトを調整する操作を教えて", { exact: true }),
  ).toHaveCount(1);
  await side
    .getByLabel("サイドチャットのメッセージ", { exact: true })
    .fill("止める相談");
  await side.getByRole("button", { name: "相談を送信", exact: true }).click();
  await side
    .getByRole("button", { name: "現在の作業を停止", exact: true })
    .click();
  await expect(side.getByText("停止しました", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "サイド確認", exact: true }).click();
  await page
    .getByRole("navigation", { name: "作品とチャット" })
    .getByRole("button", { name: /港の光の検討|未命名のチャット 1/ })
    .click();
  await choosePanel(page, "サイドチャット");
  await panel
    .getByRole("button", { name: "相談を再表示: 港の光の検討", exact: true })
    .click();
  await expect(side.getByText("停止しました", { exact: true })).toBeVisible();
  await expect(
    side.getByText("ライトを調整する操作を教えて", { exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "test-results/issue-64-side-chat.png",
    fullPage: true,
  });
});
