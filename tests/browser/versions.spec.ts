import {
  openWorkDialog,
  openSettings,
  openArtifacts,
  openChatUtilities,
  choosePanel,
} from "./ui-helpers";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("設定から定義を選び、作品の作風と固定済みの内容を開き直す", async ({
  page,
}) => {
  const fixture = JSON.parse(
    readFileSync("test-results/git-fixture.json", "utf8"),
  );
  await page.goto("/");
  await openSettings(page);
  await page.getByLabel("定義のフルコミット").fill(fixture.definition);
  await page.getByRole("button", { name: "既定定義を保存" }).click();
  await expect(
    page.getByText(`新規依頼の既定定義: ${fixture.definition}`, {
      exact: true,
    }),
  ).toBeVisible();
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("版を固定する作品");
  await page.getByLabel("作品の作風", { exact: true }).selectOption("commit");
  await page.getByLabel("作風のフルコミット").fill(fixture.style);
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "版を固定する作品" }),
  ).toBeVisible();
  await choosePanel(page, "作風・制作方針");
  await page.getByText("定義・作風の固定内容", { exact: true }).click();
  await expect(
    page.getByText("固定内容の検査: 利用可能", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "依頼用の参照を固定", exact: true })
    .click();
  await page.getByText("固定済み参照 1", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "definition: instructions.md を読む",
      exact: true,
    })
    .click();
  await expect(page.locator(".fixed-content")).toHaveText("固定された指示");
  await page.reload();
  await page
    .getByRole("button", { name: "版を固定する作品", exact: true })
    .click();
  await choosePanel(page, "作風・制作方針");
  await page.getByText("定義・作風の固定内容", { exact: true }).click();
  await expect(page.getByText("固定済み参照 1", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/versions.png", fullPage: true });
});
