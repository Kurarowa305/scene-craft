import { sendRecord } from "./ui-helpers";
import {
  openWorkDialog,
  openSettings,
  choosePanel,
  openArtifacts,
  openConnectionSettings,
  closeSettings,
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

test("種類を選ぶと中間画面なしでサイドチャットを開く", async ({ page }) => {
  await page.goto("/");
  await createMain(page, "直接開く相談");
  await choosePanel(page, "サイドチャット");
  await expect(
    page.getByRole("region", { name: "サイドチャットの会話" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "相談を開始", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("保存済みの相談", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("接続・会話の設定", { exact: true })).toHaveCount(
    0,
  );
});

test("複数の新しい相談を同時に開いても、別々の会話として確定する", async ({
  page,
}) => {
  await page.goto("/");
  await createMain(page, "並行して開く相談");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/conversations/*/side-chats", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests++;
    await gate;
    await route.continue();
  });
  await choosePanel(page, "サイドチャット");
  await choosePanel(page, "サイドチャット");
  try {
    await expect.poll(() => requests).toBe(2);
  } finally {
    release();
  }
  await expect(
    page.getByRole("region", { name: "サイドチャットの会話" }),
  ).toHaveCount(1);
  const works = await (await page.request.get("/api/works")).json();
  const work = works.find(
    (w: { name: string }) => w.name === "並行して開く相談",
  );
  const main = (
    await (await page.request.get(`/api/works/${work.id}/conversations`)).json()
  )[0];
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/conversations/${main.id}/side-chats`)
          ).json()
        ).length,
    )
    .toBe(2);
});

test("右タブでメインと並行して相談し、停止後も原文を保持する", async ({
  page,
}) => {
  await page.goto("/");
  await createMain(page, "サイド確認");
  const main = page.getByRole("region", { name: "Codexとの会話", exact: true });
  const panel = page.getByRole("complementary", { name: "右側タブ" });
  await main
    .getByLabel("会話モデル", { exact: true })
    .selectOption("fixture-a");
  await openConnectionSettings(page);
  await page
    .getByLabel("命名・要約モデル", { exact: true })
    .selectOption("fixture-a");
  await closeSettings(page);
  await main.getByLabel("メッセージ", { exact: true }).fill("メインの制作相談");
  await main.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await choosePanel(page, "サイドチャット");
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
  await side
    .getByLabel("サイドチャットのメッセージ", { exact: true })
    .press("Enter");
  await expect(side.getByText("保存される返答", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("tab", { name: "港の光の検討", exact: true }),
  ).toBeVisible();
  await side
    .getByLabel("サイドチャットのメッセージ", { exact: true })
    .fill("止める相談");
  await side.getByRole("button", { name: "相談を送信", exact: true }).click();
  await side
    .getByRole("button", { name: "現在の作業を停止", exact: true })
    .click();
  await expect(side.getByText("停止しました", { exact: true })).toBeVisible();
  const works = await (await page.request.get("/api/works")).json();
  const work = works.find((w: { name: string }) => w.name === "サイド確認");
  const conversations = await (
    await page.request.get(`/api/works/${work.id}/conversations`)
  ).json();
  const saved = await (
    await page.request.get(
      `/api/conversations/${conversations[0].id}/side-chats`,
    )
  ).json();
  expect(saved).toHaveLength(1);
  const view = await (
    await page.request.get(`/api/conversations/${saved[0].conversationId}/chat`)
  ).json();
  expect(view.requests.map((r: { body: string }) => r.body)).toEqual([
    "ライトを調整する操作を教えて",
    "止める相談",
  ]);
  await page.screenshot({
    path: "test-results/issue-64-side-chat.png",
    fullPage: true,
  });
});
