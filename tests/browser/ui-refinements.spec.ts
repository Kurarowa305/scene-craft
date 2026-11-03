import { readFileSync } from "node:fs";
import { openSettings, choosePanel } from "./ui-helpers";
import { test, expect } from "@playwright/test";
import { openWorkDialog, sendRecord } from "./ui-helpers";

test("手作業記録と空表示を会話から外し、三点メニューで名前を編集する", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 960 });
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("UI修正の作品");
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", { name: "UI修正の作品に新しいチャット", exact: true })
    .click();
  await expect(
    page.getByText("まだ記録はありません。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("接続・会話の設定", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("チャットに表示しない手作業本文");
  await sendRecord(page);
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue("");
  await expect(
    page.getByText("チャットに表示しない手作業本文", { exact: true }),
  ).toHaveCount(0);
  const nameMenu = page.getByRole("button", {
    name: "未命名のチャット 1のメニュー",
    exact: true,
  });
  await nameMenu.focus();
  await nameMenu.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "編集", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("menuitem", { name: "編集", exact: true })
    .press("Enter");
  const input = page.getByRole("textbox", {
    name: "チャット名を編集",
    exact: true,
  });
  await input.fill("港の検討");
  await page.screenshot({ path: "test-results/issue-102-chat-name.png" });
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "港の検討", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "港の検討", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "会話名を保存", exact: true }),
  ).toHaveCount(0);
});

test("Enter送信・Shift Enter改行と、外側を押して閉じるポップアップ", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 960 });
  await page.goto("/");
  await openSettings(page);
  const git = JSON.parse(readFileSync("test-results/git-fixture.json", "utf8"));
  await page.getByLabel("定義のフルコミット").fill(git.definition);
  await page
    .getByRole("button", { name: "既定定義を保存", exact: true })
    .click();
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("入力とポップアップ");
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "入力とポップアップに新しいチャット",
      exact: true,
    })
    .click();
  const input = page.getByLabel("メッセージ", { exact: true });
  await expect(page.getByLabel("会話モデル", { exact: true })).toBeEnabled();
  await input.fill("改行を確認");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("改行を確認\n");
  let sent = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/messages"))
      sent++;
  });
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  expect(sent).toBe(0);
  await expect(input).toHaveValue("改行を確認\n");
  await input.fill("Enterから相談する");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(page.getByText("保存される返答", { exact: true })).toBeVisible();
  await expect(
    page.getByText("まだ記録はありません。", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "履歴を照合", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("制作ワークスペース", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "成果物・ファイルを添付", exact: true })
    .click();
  await expect(
    page.getByRole("menu", { name: "成果物・ファイルを添付", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(
    page.getByRole("menu", { name: "成果物・ファイルを添付", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "モデルの詳細設定", exact: true })
    .click();
  await expect(
    page.getByRole("menu", { name: "モデルの詳細設定", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "モデルの詳細設定", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("menu", { name: "モデルの詳細設定", exact: true }),
  ).toHaveCount(0);
  await choosePanel(page, "サイドチャット");
  const side = page.getByRole("region", { name: "サイドチャットの会話" });
  await expect(side).toBeVisible();
  await expect(
    page.getByRole("button", { name: "相談を開始", exact: true }),
  ).toHaveCount(0);
  await side
    .getByRole("button", { name: "モデルの詳細設定", exact: true })
    .click();
  const menu = page.getByRole("menu", {
    name: "モデルの詳細設定",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: "test-results/issue-102-side-settings.png" });
  const bounds = await menu.boundingBox(),
    pane = await page
      .getByRole("complementary", { name: "右側タブ" })
      .boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(pane!.x);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(pane!.x + pane!.width);
  await side
    .getByRole("heading", { name: "サイドチャット", exact: true })
    .click();
  await expect(menu).toHaveCount(0);
  const tabs = page.getByRole("tablist").locator(".tab");
  const last = await tabs.last().boundingBox(),
    add = await page
      .getByRole("button", { name: "新しいタブ", exact: true })
      .boundingBox();
  expect(add!.x - (last!.x + last!.width)).toBeLessThanOrEqual(12);
});

test("成果物を選び直した後も、相談作成の応答喪失を初回の入力で回復する", async ({
  page,
}) => {
  await page.goto("/");
  await openSettings(page);
  const git = JSON.parse(readFileSync("test-results/git-fixture.json", "utf8"));
  await page.getByLabel("定義のフルコミット").fill(git.definition);
  await page
    .getByRole("button", { name: "既定定義を保存", exact: true })
    .click();
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("相談の再試行入力");
  await page
    .getByRole("dialog", { name: "作品を作成" })
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "相談の再試行入力に新しいチャット",
      exact: true,
    })
    .click();
  await page
    .getByLabel("コンピューターからファイルを選択", { exact: true })
    .setInputFiles({
      name: "context.psd",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("saved file"),
    });
  await expect(page.getByText("context.psd", { exact: true })).toBeVisible();
  await page.getByLabel("メッセージ", { exact: true }).fill("相談用の状態");
  await sendRecord(page);
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue("");
  await page.route(
    "**/api/conversations/*/side-chats",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await choosePanel(page, "サイドチャット");
  await expect(
    page.getByRole("button", { name: "再試行", exact: true }),
  ).toBeVisible();
  await choosePanel(page, "成果物");
  await page.getByRole("button", { name: /context.psd.*Photoshop/ }).click();
  await page.getByRole("tab", { name: "サイドチャット", exact: true }).click();
  await page.getByRole("button", { name: "再試行", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "サイドチャットの会話" }),
  ).toBeVisible();
  const works = await (await page.request.get("/api/works")).json();
  const work = works.find(
    (w: { name: string }) => w.name === "相談の再試行入力",
  );
  const main = (
    await (await page.request.get(`/api/works/${work.id}/conversations`)).json()
  )[0];
  const sides = await (
    await page.request.get(`/api/conversations/${main.id}/side-chats`)
  ).json();
  expect(sides).toHaveLength(1);
  const context = await (
    await page.request.get(
      `/api/conversations/${sides[0].conversationId}/side-context`,
    )
  ).json();
  expect(context.selectedStates).toEqual([]);
});
