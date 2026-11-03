import {
  openWorkDialog,
  openSettings,
  openArtifacts,
  openConnectionSettings,
  closeSettings,
  choosePanel,
} from "./ui-helpers";
import { test, expect } from "@playwright/test";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../../src/server/app.js";
import { gitFixture, cleanGitFixture } from "../git-fixture.js";

// The auxiliary model is an application-wide setting, so this spec owns an
// isolated app rather than changing the settings of other browser specs.
test.use({ baseURL: "http://localhost:4518" });
let app: Awaited<ReturnType<typeof createApp>>;
let directory: string;
let definition: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "auxiliary-browser-"));
  const git = await gitFixture(directory);
  definition = git.definition;
  await chmod("tests/fixtures/codex.mjs", 0o700);
  app = await createApp({
    directory,
    port: 4518,
    gitRepository: git.repository,
    codexBinary: resolve("tests/fixtures/codex.mjs"),
    staticRoot: resolve("dist/client"),
  });
  await app.listen({ host: "127.0.0.1", port: 4518 });
});
test.afterAll(async () => {
  await app?.close();
  if (directory) await cleanGitFixture(directory);
});

test("設定で補助モデルを変更し、一覧で会話名を編集して開き直せる", async ({
  page,
}) => {
  await page.goto("/");
  await openSettings(page);
  await page.getByLabel("定義のフルコミット").fill(definition);
  await page
    .getByRole("button", { name: "既定定義を保存", exact: true })
    .click();
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("命名と要約確認");
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "命名と要約確認に新しいチャット",
      exact: true,
    })
    .click();
  await openConnectionSettings(page);
  await expect(
    page.getByLabel("命名・要約モデル", { exact: true }),
  ).toHaveValue("gpt-6-luna");
  await page
    .getByLabel("命名・要約モデル", { exact: true })
    .selectOption("fixture-a");
  await page.screenshot({ path: "test-results/issue-102-chat-settings.png" });
  await closeSettings(page);
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("夕暮れの港の光について相談したい");
  await page.getByLabel("メッセージ", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "港の光の検討", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "港の光の検討のメニュー", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "編集", exact: true }).click();
  await page
    .getByLabel("チャット名を編集", { exact: true })
    .fill("人間が付けた港の相談");
  await page.getByLabel("チャット名を編集", { exact: true }).press("Enter");
  await expect(
    page.getByRole("heading", { name: "人間が付けた港の相談", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "命名と要約確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "人間が付けた港の相談", exact: true })
    .click();
  await openConnectionSettings(page);
  await expect(
    page.getByLabel("命名・要約モデル", { exact: true }),
  ).toHaveValue("fixture-a");
  await closeSettings(page);
  await expect(page.getByText("接続・会話の設定", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "履歴を照合", exact: true }),
  ).toHaveCount(0);
});
