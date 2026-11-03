import { type Page, expect } from "@playwright/test";
export async function openWorkDialog(page: Page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible())
    await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
}
export async function openSettings(page: Page) {
  await page
    .getByRole("button", { name: "設定・保存データ", exact: true })
    .click();
}
export async function choosePanel(page: Page, title: string) {
  await page.getByRole("button", { name: "新しいタブ", exact: true }).click();
  await page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getByRole("button", { name: new RegExp(`^${title} `) })
    .click();
}
export async function openArtifacts(page: Page) {
  await choosePanel(page, "成果物");
}
export async function openChatUtilities(page: Page) {
  const utilities = page
    .getByRole("region", { name: "Codexとの会話", exact: true })
    .locator(".chat-utilities");
  await expect(utilities).toBeVisible();
  if ((await utilities.getAttribute("open")) === null)
    await utilities.locator("summary").first().click();
}

export async function sendRecord(page: Page) {
  const mode = page.getByLabel("送信方法", { exact: true });
  if (await mode.isEnabled()) await mode.selectOption("record");
  await page
    .getByRole("button", { name: "記録として送信", exact: true })
    .click();
}
