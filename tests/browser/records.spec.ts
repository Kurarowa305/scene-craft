import { test, expect } from "@playwright/test";

test("作品内に空の会話を作り、本文を記録して開き直す", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("作品名").fill("夕暮れの港");
  await page.getByLabel("制作意図（任意）").fill("静けさと余韻");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await expect(page.getByRole("heading", { name: "夕暮れの港" })).toBeVisible();
  await page
    .getByRole("button", { name: "夕暮れの港に新しいチャット" })
    .click();
  await expect(page.getByText("まだ記録はありません。")).toBeVisible();
  const original = "  手作業の記録\n<script>文字のまま</script>\n";
  await page.getByLabel("記録する本文").fill(original);
  await page
    .getByRole("button", { name: "記録として送信", exact: true })
    .click();
  await expect(page.locator(".record-body")).toHaveText(original);
  await page.reload();
  await page.getByRole("button", { name: "夕暮れの港", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.locator(".record-body")).toHaveText(original);
  await expect(
    page.getByText("作風なし", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/records.png", fullPage: true });
});

test("保存応答が失われても入力を保ち、同じ受付キーで再送して重複を作らない", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("作品名").fill("再送の作品");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "再送の作品に新しいチャット" })
    .click();
  await page.getByLabel("記録する本文").fill("保存応答が失われた原文");
  await page.route("**/api/conversations/*/records", async (route) => {
    if (route.request().method() === "POST") {
      await route.fetch(); // The real backend commits, but the browser loses its response.
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "記録として送信", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("確認できません");
  await expect(page.getByLabel("記録する本文")).toHaveValue(
    "保存応答が失われた原文",
  );
  await expect(page.locator(".record-body")).toHaveCount(0);
  await page.unrouteAll();
  await page
    .getByRole("button", { name: "記録として送信", exact: true })
    .click();
  await expect(page.locator(".record-body")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: "再送の作品", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.locator(".record-body")).toHaveCount(1);
});

test("作品の作成失敗では作品を追加せず、作品名・制作意図を保持する", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("作品名").fill("保存に失敗する作品");
  await page.getByLabel("制作意図（任意）").fill("消してはいけない意図");
  await page.route("**/api/works", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"SAVE_FAILED"}',
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("確認できません");
  await expect(page.getByLabel("作品名")).toHaveValue("保存に失敗する作品");
  await expect(page.getByLabel("制作意図（任意）")).toHaveValue(
    "消してはいけない意図",
  );
  await expect(
    page.getByRole("button", { name: "保存に失敗する作品", exact: true }),
  ).toHaveCount(0);
});

test("別作品の＋から直接空のチャットを開き、チャットごとの本文と入力を混ぜない", async ({
  page,
}) => {
  await page.goto("/");
  for (const name of ["作品A", "作品B"]) {
    await page.getByLabel("作品名").fill(name);
    await page.getByRole("button", { name: "作品を作成", exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "作品Aに新しいチャット" }).click();
  await expect(
    page.getByRole("heading", { name: "作品A", exact: true }),
  ).toBeVisible();
  await page.getByLabel("記録する本文").fill("Aの未送信本文");
  await page.getByRole("button", { name: "作品Bに新しいチャット" }).click();
  await expect(page.getByLabel("記録する本文")).toHaveValue("");
  await page.getByLabel("記録する本文").fill("Bの記録");
  await page
    .getByRole("button", { name: "記録として送信", exact: true })
    .click();
  await expect(page.locator(".record-body")).toHaveText("Bの記録");
  await page.getByRole("button", { name: "作品A", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.getByLabel("記録する本文")).toHaveValue("Aの未送信本文");
  await expect(page.locator(".record-body")).toHaveCount(0);
});

test("初期作品一覧の遅延中は作成を待ち、古い一覧で作成結果を消さない", async ({
  page,
}) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/works", async (route) => {
    if (route.request().method() === "GET") {
      const response = await route.fetch();
      await released;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("作品名").fill("一覧取得後の作品");
  await expect(
    page.getByRole("button", { name: "作品を作成", exact: true }),
  ).toBeDisabled();
  release();
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "一覧取得後の作品", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "一覧取得後の作品", exact: true }),
  ).toBeVisible();
});
