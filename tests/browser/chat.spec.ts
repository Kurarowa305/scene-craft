import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("モデル選択・SSE再接続・会話継続・停止を画面から行う", async ({
  page,
}) => {
  const git = JSON.parse(readFileSync("test-results/git-fixture.json", "utf8"));
  await page.goto("/");
  await page.getByLabel("定義のフルコミット").fill(git.definition);
  await page
    .getByRole("button", { name: "既定定義を保存", exact: true })
    .click();
  await expect(
    page.getByText(`新規依頼の既定定義: ${git.definition}`, { exact: true }),
  ).toBeVisible();
  await page.getByLabel("作品名", { exact: true }).fill("Codex確認");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page.getByRole("button", { name: "Codex確認に新しいチャット" }).click();
  await expect(page.getByLabel("会話モデル", { exact: true })).toHaveValue(
    "fixture-a",
  );
  await page.getByLabel("工程", { exact: true }).selectOption("reference");
  await page.getByLabel("Codexへのメッセージ").fill("港について相談");
  await page.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await expect(page.getByText("応答中", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Codex確認", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.getByText("保存される返答", { exact: true })).toBeVisible();
  await expect(page.getByText("完了", { exact: true })).toBeVisible();
  await expect(page.getByText("港について相談", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    page.getByText("工程: reference", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("工程", { exact: true }).selectOption("none");
  await page
    .getByLabel("会話モデル", { exact: true })
    .selectOption("fixture-b");
  await expect(
    page.getByRole("button", { name: "接続状態を更新" }),
  ).toBeEnabled();
  await page.getByLabel("Codexへのメッセージ").fill("続きの相談");
  await page.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByText("停止しました", { exact: true })).toBeVisible();
  // A slow catalog response must not roll a newer SSE terminal back to running.
  let releaseStatus: () => void = () => {};
  const heldStatus = new Promise<void>((resolve) => (releaseStatus = resolve));
  await page.route(
    "**/api/codex",
    async (route) => {
      await heldStatus;
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByLabel("Codexへのメッセージ").fill("接続状態が遅い間の会話");
  await page.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await expect(page.getByText("完了", { exact: true })).toHaveCount(2);
  releaseStatus();
  await expect(
    page.getByRole("button", { name: "接続状態を更新" }),
  ).toBeEnabled();
  await expect(page.getByText("完了", { exact: true })).toHaveCount(2);
  let releaseContext: () => void = () => {};
  let returnedContext: () => void = () => {};
  const contextReturned = new Promise<void>((resolve) => {
    returnedContext = resolve;
  });
  const heldContext = new Promise<void>((resolve) => {
    releaseContext = resolve;
  });
  await page.route(
    "**/api/works/*/context",
    async (route) => {
      const response = await route.fetch();
      await heldContext;
      await route.fulfill({ response });
      returnedContext();
    },
    { times: 1 },
  );
  await page
    .getByLabel("Codexへのメッセージ")
    .fill("制作意図を更新: 夕暮れの静かな港");
  await page.getByRole("button", { name: "Codexへ送信", exact: true }).click();
  await expect(
    page.getByText("明示した内容を記録しました", { exact: true }),
  ).toBeVisible();
  await page.getByText("共有情報と更新履歴", { exact: true }).click();
  await expect(
    page.getByText("現在の制作意図: 夕暮れの静かな港", { exact: true }),
  ).toBeVisible();
  releaseContext();
  await contextReturned;
  await expect(
    page.getByText("現在の制作意図: 夕暮れの静かな港", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/chat.png", fullPage: true });
});
