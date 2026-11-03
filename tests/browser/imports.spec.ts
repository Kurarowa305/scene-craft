import { test, expect } from "@playwright/test";

test("制作ファイルを取り込み、手修正の変更前後と任意理由を開き直して確認する", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("作品名").fill("ファイル取り込みの作品");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "ファイル取り込みの作品に新しいチャット" })
    .click();
  await page.getByText("制作ファイルを添付して記録", { exact: true }).click();
  await page.getByLabel("作業アプリ").selectOption("Photoshop");
  await page
    .getByLabel("PSD / PSBファイル（フォルダー内の相対パス）")
    .fill("drawing.psd");
  await page.getByLabel("ファイル記録の本文").fill("最初の取り込み");
  await page
    .getByRole("button", { name: "ファイルと本文を記録", exact: true })
    .click();
  await expect(page.locator(".saved-state")).toHaveCount(1);
  await expect(page.locator(".saved-state")).toContainText(
    "取り込み前の経緯は不明",
  );
  await page
    .getByLabel("PSD / PSBファイル（フォルダー内の相対パス）")
    .fill("after.psb");
  await page.getByLabel("ファイル記録の本文").fill("色を調整\n暖かくしたい");
  await expect(page.getByLabel("手修正の理由（任意）")).toHaveCount(0);
  await page
    .getByRole("button", { name: "ファイルと本文を記録", exact: true })
    .click();
  await expect(page.locator(".saved-state")).toHaveCount(2);
  await expect(page.locator(".saved-state").nth(1)).toContainText(
    "変更前：保存状態 1 → 変更後：保存状態 2",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "ファイル取り込みの作品", exact: true })
    .click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.locator(".saved-state").nth(1)).toContainText(
    "暖かくしたい",
  );
  await expect(page.locator(".record-body")).toHaveText([
    "最初の取り込み",
    "色を調整\n暖かくしたい",
  ]);
  await page.screenshot({ path: "test-results/imports.png", fullPage: true });
});

test("失敗時は入力と未完成を保ち、中止後に修正したファイルで登録できる", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("作品名").fill("取り込みの失敗");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "取り込みの失敗に新しいチャット" })
    .click();
  await page.getByText("制作ファイルを添付して記録", { exact: true }).click();
  await page
    .getByLabel("PSD / PSBファイル（フォルダー内の相対パス）")
    .fill("absent.psd");
  await page.getByLabel("ファイル記録の本文").fill("保持する原文");
  await page
    .getByRole("button", { name: "ファイルと本文を記録", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "未完成の登録を中止" }),
  ).toBeVisible();
  await expect(page.getByLabel("ファイル記録の本文")).toHaveValue(
    "保持する原文",
  );
  await expect(page.locator(".saved-state")).toHaveCount(0);
  await page.getByRole("button", { name: "未完成の登録を中止" }).click();
  await page
    .getByLabel("PSD / PSBファイル（フォルダー内の相対パス）")
    .fill("drawing.psd");
  await page
    .getByRole("button", { name: "ファイルと本文を記録", exact: true })
    .click();
  await expect(page.locator(".saved-state")).toHaveCount(1);
  await expect(page.locator(".record-body")).toHaveText("保持する原文");
});
