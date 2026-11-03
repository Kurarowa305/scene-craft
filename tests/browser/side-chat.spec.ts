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

test("遅い相談一覧を受信しても新しく作った相談を失わない", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("定義のフルコミット").fill(definition);
  await page
    .getByRole("button", { name: "既定定義を保存", exact: true })
    .click();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fetched = () => {};
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
  await page.getByLabel("作品名", { exact: true }).fill("相談一覧遅延");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "相談一覧遅延に新しいチャット" })
    .click();
  await ready;
  const panel = page.getByRole("complementary", { name: "右側タブ" });
  await expect(panel.getByLabel("メインの話題")).toHaveCount(0);
  await panel.getByRole("button", { name: "相談を開始", exact: true }).click();
  await expect(
    panel.getByRole("tab", { name: "未命名のサイドチャット 1", exact: true }),
  ).toBeVisible();
  release();
  await panel
    .getByRole("button", { name: "タブを閉じる", exact: true })
    .click();
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
  await page.getByLabel("定義のフルコミット").fill(definition);
  await page
    .getByRole("button", { name: "既定定義を保存", exact: true })
    .click();
  await expect(
    page.getByText(`新規依頼の既定定義: ${definition}`, { exact: true }),
  ).toBeVisible();
  await page.getByLabel("作品名", { exact: true }).fill("サイド確認");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "サイド確認に新しいチャット" })
    .click();
  const main = page.getByRole("region", { name: "Codexとの会話", exact: true });
  await expect(main.getByLabel("会話モデル", { exact: true })).toBeEnabled();
  await main
    .getByLabel("会話モデル", { exact: true })
    .selectOption("fixture-a");
  await main.getByText("保存用要約・根拠・補助モデル", { exact: true }).click();
  await main
    .getByLabel("命名・要約モデル", { exact: true })
    .selectOption("fixture-a");
  const panel = page.getByRole("complementary", { name: "右側タブ" });
  await expect(
    panel.getByLabel("参照する保存済み成果物").locator("option"),
  ).toHaveCount(0);
  await page.getByText("制作ファイルを添付して記録", { exact: true }).click();
  await page.getByLabel("作業アプリ").selectOption("Photoshop");
  await page
    .getByLabel("PSD / PSBファイル（フォルダー内の相対パス）")
    .fill("drawing.psd");
  await page.getByLabel("ファイル記録の本文").fill("相談開始直前の成果物");
  await page
    .getByRole("button", { name: "ファイルと本文を記録", exact: true })
    .click();
  const outputs = panel.getByLabel("参照する保存済み成果物");
  await expect(outputs.locator("option")).toHaveCount(1);
  await outputs.selectOption({ index: 0 });
  await main.getByLabel("Codexへのメッセージ").fill("メインの制作相談");
  await main.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await expect(panel.getByLabel("タブの種類")).toHaveValue("サイドチャット");
  await expect(panel.getByLabel("メインの話題")).toHaveCount(0);
  await panel.getByRole("button", { name: "相談を開始", exact: true }).click();
  const side = panel.getByRole("region", { name: "サイドチャットの会話" });
  await expect(side.getByLabel("会話モデル", { exact: true })).toHaveValue(
    "fixture-a",
  );
  await expect(side.getByLabel("工程", { exact: true })).toHaveCount(0);
  await side
    .getByLabel("Codexへのメッセージ")
    .fill("ライトを調整する操作を教えて");
  await side.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await expect(side.getByText("応答中", { exact: true })).toBeVisible();
  await panel
    .getByRole("button", { name: "タブを閉じる", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "相談を再表示: 港の光の検討", exact: true })
    .click();
  await expect(side.getByText("保存される返答", { exact: true })).toBeVisible();
  await expect(
    side.getByText("ライトを調整する操作を教えて", { exact: true }),
  ).toHaveCount(1);
  await side.getByLabel("Codexへのメッセージ").fill("止める相談");
  await side.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await side.getByRole("button", { name: "停止", exact: true }).click();
  await expect(side.getByText("停止しました", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "サイド確認", exact: true }).click();
  await page
    .getByRole("navigation", { name: "作品とチャット" })
    .getByRole("button", { name: /港の光の検討|未命名のチャット 1/ })
    .click();
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
