import { recordBodies } from "./ui-helpers";
import { sendRecord } from "./ui-helpers";
import {
  openWorkDialog,
  openSettings,
  openArtifacts,
  choosePanel,
} from "./ui-helpers";
import { test, expect } from "@playwright/test";

test("作品内に空の会話を作り、本文を記録して開き直す", async ({ page }) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名").fill("夕暮れの港");
  await page.getByLabel("制作意図（任意）").fill("静けさと余韻");
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "夕暮れの港" })).toBeVisible();
  await page
    .getByRole("button", { name: "夕暮れの港に新しいチャット", exact: true })
    .click();
  await expect(page.getByText("まだ記録はありません。")).toHaveCount(0);
  const original = "  手作業の記録\n<script>文字のまま</script>\n";
  await page.getByLabel("メッセージ", { exact: true }).fill(original);
  await sendRecord(page);
  await expect.poll(() => recordBodies(page, "夕暮れの港")).toEqual([original]);
  await page.reload();
  await page.getByRole("button", { name: "夕暮れの港", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect.poll(() => recordBodies(page, "夕暮れの港")).toEqual([original]);
  await openWorkDialog(page);
  await expect(
    page.getByRole("combobox", { name: "作品の作風", exact: true }),
  ).toHaveValue("none");
  await page.screenshot({ path: "test-results/records.png", fullPage: true });
});

test("保存応答が失われても入力を保ち、同じ受付キーで再送して重複を作らない", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名").fill("再送の作品");
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", { name: "再送の作品に新しいチャット", exact: true })
    .click();
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("保存応答が失われた原文");
  await page.route("**/api/conversations/*/records", async (route) => {
    if (route.request().method() === "POST") {
      await route.fetch(); // The real backend commits, but the browser loses its response.
      await route.abort("failed");
    } else await route.continue();
  });
  await sendRecord(page);
  await expect(page.getByRole("alert")).toContainText("確認できません");
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue(
    "保存応答が失われた原文",
  );
  await expect(page.locator(".record-body")).toHaveCount(0);
  await page.unrouteAll();
  await sendRecord(page);
  await expect
    .poll(() => recordBodies(page, "再送の作品"))
    .toEqual(["保存応答が失われた原文"]);
  await page.reload();
  await page.getByRole("button", { name: "再送の作品", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect
    .poll(() => recordBodies(page, "再送の作品"))
    .toEqual(["保存応答が失われた原文"]);
});

test("作品の作成失敗では作品を追加せず、作品名・制作意図を保持する", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
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
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
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
    await openWorkDialog(page);
    await page.getByLabel("作品名").fill(name);
    await page
      .getByRole("dialog", { name: "作品を作成" })
      .getByRole("button", { name: "作品を作成", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "作品Aに新しいチャット", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "未命名のチャット 1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("メッセージ", { exact: true }).fill("Aの未送信本文");
  await page
    .getByRole("button", { name: "作品Bに新しいチャット", exact: true })
    .click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue("");
  await page.getByLabel("メッセージ", { exact: true }).fill("Bの記録");
  await sendRecord(page);
  await expect.poll(() => recordBodies(page, "作品B")).toEqual(["Bの記録"]);
  await page.getByRole("button", { name: "作品A", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue(
    "Aの未送信本文",
  );
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
  await openWorkDialog(page);
  await page.getByLabel("作品名").fill("一覧取得後の作品");
  await expect(
    page
      .getByRole("dialog", { name: "作品を作成" })
      .getByRole("button", { name: "作品を作成", exact: true }),
  ).toBeDisabled();
  release();
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "一覧取得後の作品", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "一覧取得後の作品", exact: true }),
  ).toBeVisible();
});

test("本文の保存応答を待つ間は会話を切り替えず、別会話へ記録を混ぜない", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("保存中の切替確認");
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  const create = page.getByRole("button", {
    name: "保存中の切替確認に新しいチャット",
    exact: true,
  });
  await create.click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeEnabled();
  await create.click();
  await expect(
    page.getByRole("heading", { name: "未命名のチャット 2", exact: true }),
  ).toBeVisible();
  let release = () => {},
    fetched = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  await page.route("**/api/conversations/*/records", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    fetched();
    await gate;
    await route.fulfill({ response });
  });
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("チャット2にだけ保存する本文");
  await sendRecord(page);
  await ready;
  const first = page.getByRole("button", {
    name: "未命名のチャット 1",
    exact: true,
  });
  try {
    await expect(first).toBeDisabled();
  } finally {
    release();
  }
  await expect
    .poll(() => recordBodies(page, "保存中の切替確認", 1))
    .toEqual(["チャット2にだけ保存する本文"]);
  await first.click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeEnabled();
  await expect(page.locator(".record-body")).toHaveCount(0);
});
