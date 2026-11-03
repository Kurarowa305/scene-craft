import { test, expect } from "@playwright/test";
import { openWorkDialog, openArtifacts, recordBodies } from "./ui-helpers";

test("作品作成で既存ファイルを選んで取り込み、成果物タブから開き直せる", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page
    .getByLabel("作品名", { exact: true })
    .fill("最初のファイルから開始");
  await page
    .getByLabel("既存ファイルから始める", { exact: false })
    .setInputFiles({
      name: "drawing.psd",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("saved production source"),
    });
  await page.screenshot({
    path: "test-results/issue-102-create-work-file.png",
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeVisible();
  await expect(page.getByText(/保存済みデータが対象/)).toHaveCount(0);
  await openArtifacts(page);
  await expect(
    page.getByText("制作ファイルを添付して記録", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /drawing.psd/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "保存状態", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() => recordBodies(page, "最初のファイルから開始"))
    .toEqual(["drawing.psdを取り込みました。"]);
  await page.reload();
  await page
    .getByRole("button", { name: "最初のファイルから開始", exact: true })
    .click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await openArtifacts(page);
  await expect(
    page.getByRole("button", { name: /drawing[.]psd/ }),
  ).toBeVisible();
});

test("初期取り込みの応答を失っても同じ作品と会話で再試行する", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("初期取り込み再試行");
  await page
    .getByLabel("既存ファイルから始める", { exact: false })
    .setInputFiles({
      name: "start.blend",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("blend source"),
    });
  let lost = false;
  const inputs: string[] = [];
  await page.route("**/api/conversations/*/imports", async (route) => {
    inputs.push(route.request().postData()!);
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    await route.abort("failed");
  });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("作品名", { exact: true })).toBeDisabled();
  await dialog
    .getByRole("button", { name: "同じ内容で再試行", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toBe(inputs[0]);
  const works = await (await page.request.get("/api/works")).json();
  const matches = works.filter(
    (w: { name: string }) => w.name === "初期取り込み再試行",
  );
  expect(matches).toHaveLength(1);
  const chats = await (
    await page.request.get(`/api/works/${matches[0].id}/conversations`)
  ).json();
  expect(chats).toHaveLength(1);
  await openArtifacts(page);
  await expect(
    page.getByRole("button", { name: /start[.]blend/ }),
  ).toBeVisible();
});

test("初期ファイルの受け渡しが失敗しても作成済み作品を開いて続けられる", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("取り込みをやめて継続");
  await page
    .getByLabel("既存ファイルから始める", { exact: false })
    .setInputFiles({
      name: "failed.psd",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("saved source"),
    });
  await page.route("**/api/conversations/*/attachments/*", (route) =>
    route.abort("failed"),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", { name: "取り込みを中止して作品を開く", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeVisible();
  await openArtifacts(page);
  await expect(
    page.getByText("成果物はまだありません。", { exact: true }),
  ).toBeVisible();
  await openWorkDialog(page);
  await expect(page.getByLabel("作品名", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("作品名", { exact: true })).toHaveValue("");
});

test("作品作成が明示的に拒否されたらファイルを保持したまま入力を修正できる", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("作成拒否の原文");
  await page
    .getByLabel("既存ファイルから始める", { exact: false })
    .setInputFiles({
      name: "start.psd",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("saved source"),
    });
  let reject = true;
  await page.route("**/api/works", (route) => {
    if (route.request().method() !== "POST" || !reject) return route.continue();
    reject = false;
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "INVALID_INPUT" }),
    });
  });
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("作品名", { exact: true })).toBeEnabled();
  await page.getByLabel("作品名", { exact: true }).fill("入力修正後の作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await openArtifacts(page);
  await expect(page.getByRole("button", { name: /start[.]psd/ })).toBeVisible();
});

test("取り込みの結果がまだ不明なら中止済みとしてモーダルを閉じない", async ({
  page,
}) => {
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("処理途中を確認");
  await page
    .getByLabel("既存ファイルから始める", { exact: false })
    .setInputFiles({
      name: "pending.psd",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("saved source"),
    });
  let input: { requestKey: string };
  await page.route("**/api/conversations/*/imports", async (route) => {
    input = route.request().postDataJSON();
    await route.abort("failed");
  });
  await page.route("**/api/works/*/imports", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { phase: "planned", requestKey: input.requestKey },
      ]),
    }),
  );
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "取り込みを中止して作品を開く", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("保存状態を確認中");
});
