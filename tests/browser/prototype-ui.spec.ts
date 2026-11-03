import { sendRecord } from "./ui-helpers";
import { test, expect } from "@playwright/test";

test("採用済みの3領域で作品を作り、記録を保存して開き直せる", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "作品を作成" });
  await dialog.getByLabel("作品名", { exact: true }).fill("UI導線の作品");
  await dialog.getByLabel("制作意図（任意）").fill("静かな港を描く");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", { name: "UI導線の作品に新しいチャット", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "未命名のチャット 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("separator", { name: "チャットと右タブの幅" }),
  ).toBeVisible();
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("空の色を調整した。静けさを出すため。");
  await sendRecord(page);
  await expect(page.locator(".record-body")).toHaveText(
    "空の色を調整した。静けさを出すため。",
  );
  await page.reload();
  await page.getByRole("button", { name: "UI導線の作品", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.locator(".record-body")).toHaveText(
    "空の色を調整した。静けさを出すため。",
  );
  await expect(page.getByText("シナリオ選択", { exact: true })).toHaveCount(0);
});

test("入力欄の＋でOSのファイルを選び、本文と一緒に記録する", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "作品を作成" });
  await dialog.getByLabel("作品名", { exact: true }).fill("添付導線の作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", {
      name: "添付導線の作品に新しいチャット",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "成果物・ファイルを添付" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("button", {
      name: "コンピューターからファイルを添付",
      exact: true,
    })
    .click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "retouch.psd",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("Photoshop saved file"),
  });
  await expect(page.getByText("retouch.psd", { exact: true })).toBeVisible();
  await page.getByLabel("メッセージ", { exact: true }).fill("空の色を調整した");
  await sendRecord(page);
  await expect(page.locator(".record-body")).toHaveText("空の色を調整した");
  await page.getByRole("button", { name: "成果物・ファイルを添付" }).click();
  await page
    .getByRole("button", { name: "保存済み成果物を開く", exact: true })
    .click();
  const artifact = page.getByRole("button", { name: /retouch.psd.*Photoshop/ });
  await expect(artifact).toBeVisible();
  await artifact.click();
  await expect(
    page.getByText("このファイルの画像プレビューは未取得です。", {
      exact: true,
    }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "ファイルを開く", exact: true }).click();
  await download;
});

test("未実装の参考資料検索は外観のみで、検索APIを呼ばない", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("reference")) requests.push(r.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: /参考資料.*参考資料の検索/ }).click();
  await expect(
    page.getByRole("button", { name: "検索", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "参考資料の検索・保存・選択は未実装です。現在は画面の外観のみ確認できます。",
      { exact: true },
    ),
  ).toBeVisible();
  expect(requests).toEqual([]);
});

test("添付記録の応答が失われても同じ内容で再送し、保存状態を重複させない", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "作品を作成" });
  await dialog.getByLabel("作品名", { exact: true }).fill("添付再送の作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", {
      name: "添付再送の作品に新しいチャット",
      exact: true,
    })
    .click();
  await page
    .getByLabel("コンピューターからファイルを選択", { exact: true })
    .setInputFiles({
      name: "lost-response.psd",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("saved bytes"),
    });
  await expect(
    page.getByText("lost-response.psd", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("一度だけ保存する記録");
  await page.route(
    "**/api/conversations/*/imports",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await sendRecord(page);
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "作品を作成", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue(
    "一度だけ保存する記録",
  );
  await sendRecord(page);
  await expect(page.locator(".record-body")).toHaveText("一度だけ保存する記録");
  await page.getByRole("button", { name: "成果物・ファイルを添付" }).click();
  await page
    .getByRole("button", { name: "保存済み成果物を開く", exact: true })
    .click();
  await expect(page.locator(".saved-state")).toHaveCount(1);
});

test("タブの追加・閉鎖と幅の調整、未実装画面を確認できる", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 960 });
  await page.goto("/");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page.screenshot({ path: "test-results/issue-102-create-work.png" });
  const dialog = page.getByRole("dialog", { name: "作品を作成" });
  await dialog.getByLabel("作品名", { exact: true }).fill("画面比較の作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", {
      name: "画面比較の作品に新しいチャット",
      exact: true,
    })
    .click();
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("光の当たり方を調整した。視線を奥へ誘導するため。");
  await sendRecord(page);
  await expect(page.locator(".record-body")).toHaveCount(1);
  await page.screenshot({ path: "test-results/issue-102-workspace.png" });
  const separator = page.getByRole("separator", {
    name: "チャットと右タブの幅",
  });
  const previous = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute(
    "aria-valuenow",
    String(previous + 20),
  );
  await page.getByRole("button", { name: /保護一覧.*変更させない/ }).click();
  await expect(
    page.getByRole("button", { name: "保護を追加", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/issue-102-protection.png" });
  await page
    .getByRole("button", { name: "保護一覧を閉じる", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "保護一覧", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "設定・保存データ", exact: true })
    .click();
  await page.getByRole("button", { name: "バックアップ", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "バックアップを作成", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/issue-102-settings.png" });
});

test("受け渡しに失敗した添付は元の会話に保持して再送する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "作品を作成" });
  await dialog
    .getByLabel("作品名", { exact: true })
    .fill("添付先を保持する作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  const create = page.getByRole("button", {
    name: "添付先を保持する作品に新しいチャット",
    exact: true,
  });
  await create.click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeEnabled();
  await page.route(
    "**/api/conversations/*/attachments/*?*",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page
    .getByLabel("コンピューターからファイルを選択", { exact: true })
    .setInputFiles({
      name: "retry.psd",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("retry bytes"),
    });
  await expect(
    page.getByRole("button", { name: "同じファイルで再送", exact: true }),
  ).toBeVisible();
  await create.click();
  await expect(
    page.getByRole("heading", { name: "未命名のチャット 2", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "同じファイルで再送", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "同じファイルで再送", exact: true })
    .click();
  await expect(page.getByText("retry.psd", { exact: true })).toBeVisible();
});

test("作品の保存中にEscapeを押しても失敗した入力とエラーを確認できる", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "作品を作成" });
  await dialog.getByLabel("作品名", { exact: true }).fill("Escape後も残す入力");
  let release = () => {},
    fetched = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  await page.route("**/api/works", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    fetched();
    await gate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: '{"error":"SAVE_FAILED"}',
    });
  });
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await ready;
  await page.keyboard.press("Escape");
  try {
    await expect(dialog).toBeVisible();
  } finally {
    release();
  }
  await expect(dialog.getByRole("alert")).toContainText("確認できません");
  await expect(dialog.getByLabel("作品名", { exact: true })).toHaveValue(
    "Escape後も残す入力",
  );
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  await expect(dialog.getByLabel("作品名", { exact: true })).toHaveValue(
    "Escape後も残す入力",
  );
});
