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

test("画面で補助モデル・会話名・根拠付き要約の訂正と再読込を確認する", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("定義のフルコミット").fill(definition);
  await page
    .getByRole("button", { name: "既定定義を保存", exact: true })
    .click();
  await page.getByLabel("作品名", { exact: true }).fill("命名と要約確認");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "命名と要約確認に新しいチャット" })
    .click();
  await page.getByText("保存用要約・根拠・補助モデル", { exact: true }).click();
  await expect(
    page.getByLabel("命名・要約モデル", { exact: true }),
  ).toHaveValue("gpt-6-luna");
  await page
    .getByLabel("命名・要約モデル", { exact: true })
    .selectOption("fixture-a");
  await page
    .getByLabel("Codexへのメッセージ")
    .fill("夕暮れの港の光について相談したい");
  await page.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "会話名: 港の光の検討", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("港の光を検討した。採用は未確定。", { exact: true }),
  ).toBeVisible();
  await page.getByText("対象原文と根拠 (2 件)", { exact: true }).click();
  await expect(
    page.getByText("夕暮れの港の光について相談したい", { exact: true }),
  ).toHaveCount(2);
  await page
    .getByLabel("会話名を変更", { exact: true })
    .fill("人間が付けた港の相談");
  await page.getByRole("button", { name: "会話名を保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "人間が付けた港の相談", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "この要約を訂正", exact: true })
    .click();
  await page
    .getByLabel("訂正する要約", { exact: true })
    .fill("港の光を比較中。人間はまだ採用していない。");
  await page
    .getByRole("button", { name: "要約の訂正を保存", exact: true })
    .click();
  await expect(page.getByLabel("訂正する要約", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("港の光を比較中。人間はまだ採用していない。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "命名と要約確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "人間が付けた港の相談", exact: true })
    .click();
  await page.getByText("保存用要約・根拠・補助モデル", { exact: true }).click();
  await expect(
    page.getByText("港の光を比較中。人間はまだ採用していない。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("港の光を検討した。採用は未確定。", { exact: true }),
  ).toBeVisible();
});
