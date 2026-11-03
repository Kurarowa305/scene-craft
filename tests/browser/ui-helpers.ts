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
export async function openConnectionSettings(page: Page) {
  await openSettings(page);
  await page
    .getByRole("button", { name: "ChatGPT・モデル", exact: true })
    .click();
}
export async function closeSettings(page: Page) {
  await page
    .getByRole("dialog", { name: "設定・保存データ" })
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
}
export async function recordBodies(
  page: Page,
  workName: string,
  index = 0,
): Promise<string[]> {
  const works = await (await page.request.get("/api/works")).json();
  const work = works.find((work: { name: string }) => work.name === workName);
  if (!work) return [];
  const conversations = await (
    await page.request.get(`/api/works/${work.id}/conversations`)
  ).json();
  if (!conversations[index]) return [];
  const records = await (
    await page.request.get(
      `/api/conversations/${conversations[index].id}/records`,
    )
  ).json();
  return records.map((record: { body: string }) => record.body);
}

export async function sendRecord(page: Page) {
  const mode = page.getByLabel("送信方法", { exact: true });
  if (await mode.isEnabled()) await mode.selectOption("record");
  await page
    .getByRole("button", { name: "記録として送信", exact: true })
    .click();
}
