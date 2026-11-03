import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import {
  openSettings,
  openWorkDialog,
  openArtifacts,
  choosePanel,
} from "./ui-helpers";

test("画像のサブメニューが右に開き、成果物はタイトルとリンクだけを表示する", async ({
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
  await page.getByLabel("作品名", { exact: true }).fill("画像サブメニュー");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "画像サブメニューに新しいチャット",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeVisible();
  const works = await (await page.request.get("/api/works")).json();
  const work = works.find(
    (item: { name: string }) => item.name === "画像サブメニュー",
  );
  const [conversation] = await (
    await page.request.get(`/api/works/${work.id}/conversations`)
  ).json();
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = {
    origin: new URL(page.url()).origin,
    "x-csrf-token": csrfToken,
  };
  const uploaded = await page.request.post(
    `/api/conversations/${conversation.id}/attachments/${crypto.randomUUID()}?name=reference.png`,
    {
      headers: { ...headers, "content-type": "application/octet-stream" },
      data: readFileSync("tests/fixtures/chat-reference.png"),
    },
  );
  expect(uploaded.ok()).toBe(true);
  const { file } = await uploaded.json();
  const imported = await page.request.post(
    `/api/conversations/${conversation.id}/imports`,
    {
      headers,
      data: {
        requestKey: crypto.randomUUID(),
        body: "画像の保存",
        application: "Other",
        beforeStateId: null,
        files: [file],
      },
    },
  );
  expect(imported.ok()).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "画像サブメニュー", exact: true })
    .click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "成果物・ファイルを添付", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "保存済み成果物", exact: true })
    .click();
  const submenu = page.getByRole("menu", {
    name: "添付する保存済み画像",
    exact: true,
  });
  await expect(
    submenu.getByRole("menuitem", { name: "reference.png", exact: true }),
  ).toBeVisible();
  const parent = (await page
    .getByRole("menu", { name: "成果物・ファイルを添付", exact: true })
    .boundingBox())!;
  const child = (await submenu.boundingBox())!;
  expect(child.x).toBeGreaterThanOrEqual(parent.x + parent.width);
  expect(child.x + child.width).toBeLessThanOrEqual(1512);
  await page.screenshot({ path: "test-results/issue-102-image-submenu.png" });
  await page.keyboard.press("Escape");
  await expect(submenu).toHaveCount(0);
  await expect(
    page.getByRole("menu", { name: "成果物・ファイルを添付", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("heading", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page
    .getByRole("button", { name: "成果物・ファイルを添付", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "保存済み成果物", exact: true })
    .click();
  await page
    .getByRole("menu", { name: "添付する保存済み画像", exact: true })
    .getByRole("menuitem", { name: "reference.png", exact: true })
    .click();
  await expect(page.locator(".main-chat .draft-images img")).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const unchanged = await (
    await page.request.get(`/api/works/${work.id}/states`)
  ).json();
  expect(unchanged.states).toHaveLength(1);
  await openArtifacts(page);
  await expect(
    page.getByRole("button", { name: /reference.png/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "保存状態", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".saved-state")).toHaveCount(0);
  await choosePanel(page, "サイドチャット");
  await expect(
    page.getByText("制作データ・記録は変更しません", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "サイドチャットの会話", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "モデルの詳細設定", exact: true }),
  ).toHaveCount(2);
  const size = await page
    .locator(".sidebar-footer .nav-button")
    .first()
    .locator("svg")
    .evaluate((item) => item.getBoundingClientRect().width);
  for (const gear of await page
    .getByRole("button", { name: "モデルの詳細設定", exact: true })
    .all()) {
    expect(
      await gear
        .locator("svg")
        .evaluate((item) => item.getBoundingClientRect().width),
    ).toBe(size);
  }
  for (const send of await page.locator(".send:not(.stop)").all()) {
    const delta = await send.evaluate((button) => {
      const b = button.getBoundingClientRect(),
        s = button.querySelector("svg")!.getBoundingClientRect();
      return [
        Math.abs(b.x + b.width / 2 - s.x - s.width / 2),
        Math.abs(b.y + b.height / 2 - s.y - s.height / 2),
      ];
    });
    expect(Math.max(...delta)).toBeLessThan(1);
  }
  await page.screenshot({ path: "test-results/issue-102-ui-polish.png" });
});

test("保存済み画像がなくてもEscapeは子メニューだけを閉じる", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("画像がない作品");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "画像がない作品に新しいチャット",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "成果物・ファイルを添付", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "保存済み成果物", exact: true })
    .click();
  const submenu = page.getByRole("menu", {
    name: "添付する保存済み画像",
    exact: true,
  });
  await expect(submenu).toContainText("添付できる保存済み画像はありません。");
  await page.keyboard.press("Escape");
  await expect(submenu).toHaveCount(0);
  await expect(
    page.getByRole("menu", { name: "成果物・ファイルを添付", exact: true }),
  ).toBeVisible();
});
