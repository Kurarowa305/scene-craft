import { readFileSync } from "node:fs";
import { recordBodies } from "./ui-helpers";
import { sendRecord } from "./ui-helpers";
import { test, expect } from "@playwright/test";

async function prepareImageChat(page: import("@playwright/test").Page) {
  const { definition } = JSON.parse(
    readFileSync("test-results/git-fixture.json", "utf8"),
  );
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const response = await page.request.post("/api/versions/default", {
    headers: { origin: new URL(page.url()).origin, "x-csrf-token": csrfToken },
    data: { requestKey: crypto.randomUUID(), commit: definition },
  });
  expect(response.ok()).toBe(true);
}

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
  await expect
    .poll(() => recordBodies(page, "UI導線の作品"))
    .toEqual(["空の色を調整した。静けさを出すため。"]);
  await page.reload();
  await page.getByRole("button", { name: "UI導線の作品", exact: true }).click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect
    .poll(() => recordBodies(page, "UI導線の作品"))
    .toEqual(["空の色を調整した。静けさを出すため。"]);
  await expect(page.getByText("シナリオ選択", { exact: true })).toHaveCount(0);
});

test("入力欄の＋で画像をLLMに添付し、送信前と発言直上にプレビューする", async ({
  page,
}) => {
  await page.goto("/");
  await prepareImageChat(page);
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("作品名", { exact: true }).fill("画像相談の作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", {
      name: "画像相談の作品に新しいチャット",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "成果物・ファイルを添付", exact: true })
    .click();
  const choosing = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", {
      name: "コンピューターから画像を添付",
      exact: true,
    })
    .click();
  await (
    await choosing
  ).setFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: readFileSync(
      new URL("../fixtures/chat-reference.png", import.meta.url),
    ),
  });
  await expect(page.locator(".draft-images img")).toBeVisible();
  await page.screenshot({ path: "test-results/chat-image-draft.png" });
  await expect(
    page.getByRole("button", { name: "Codexへ送信", exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("この画像の色を教えて");
  await page.getByLabel("メッセージ", { exact: true }).press("Enter");
  await expect(page.locator(".message.user .sent-images img")).toBeVisible();
  await expect(page.locator(".draft-images img")).toHaveCount(0);
  const bounds = await page
    .locator(".message.user")
    .first()
    .evaluate((item) => ({
      image: item.querySelector("img")!.getBoundingClientRect().bottom,
      body: item.querySelector("p")!.getBoundingClientRect().top,
    }));
  expect(bounds.image).toBeLessThanOrEqual(bounds.body);
  await expect.poll(() => recordBodies(page, "画像相談の作品")).toEqual([]);
  const works = await (await page.request.get("/api/works")).json();
  const work = works.find(
    (item: { name: string }) => item.name === "画像相談の作品",
  );
  expect(
    (await (await page.request.get(`/api/works/${work.id}/states`)).json())
      .states,
  ).toEqual([]);
  await page.screenshot({ path: "test-results/chat-image-previews.png" });
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

test("画像の送信受付応答を失っても本文と画像を保持し、再試行で重複しない", async ({
  page,
}) => {
  await page.goto("/");
  await prepareImageChat(page);
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("作品名", { exact: true }).fill("画像再送の作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", {
      name: "画像再送の作品に新しいチャット",
      exact: true,
    })
    .click();
  await page
    .getByLabel("LLMに添付する画像を選択", { exact: true })
    .setInputFiles({
      name: "lost.png",
      mimeType: "image/png",
      buffer: readFileSync(
        new URL("../fixtures/chat-reference.png", import.meta.url),
      ),
    });
  const send = page.getByRole("button", { name: "Codexへ送信", exact: true });
  await expect(send).toBeEnabled();
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("画像を一度だけ送る");
  await page.route(
    "**/api/conversations/*/messages",
    async (route) => {
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await send.click();
  await expect(page.locator(".draft-images img")).toBeVisible();
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue(
    "画像を一度だけ送る",
  );
  await expect(send).toBeEnabled({ timeout: 15000 });
  await send.click();
  await expect(page.locator(".draft-images img")).toHaveCount(0);
  await expect(page.locator(".message.user .sent-images img")).toHaveCount(1);
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
  await expect.poll(() => recordBodies(page, "画面比較の作品")).toHaveLength(1);
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

test("画像の受け渡し失敗後も元の会話にプレビューを保持して同じ画像で再試行できる", async ({
  page,
}) => {
  await page.goto("/");
  await prepareImageChat(page);
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("作品名", { exact: true }).fill("画像保持の作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  const create = page.getByRole("button", {
    name: "画像保持の作品に新しいチャット",
    exact: true,
  });
  await create.click();
  const ids: string[] = [];
  await page.route(
    "**/api/conversations/*/images/*?*",
    async (route) => {
      ids.push(route.request().url());
      await route.fetch();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page
    .getByLabel("LLMに添付する画像を選択", { exact: true })
    .setInputFiles({
      name: "retry.png",
      mimeType: "image/png",
      buffer: readFileSync(
        new URL("../fixtures/chat-reference.png", import.meta.url),
      ),
    });
  await expect(
    page.getByRole("button", { name: "同じ画像で再試行", exact: true }),
  ).toBeVisible();
  await create.click();
  await expect(page.locator(".draft-images img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.locator(".draft-images img")).toBeVisible();
  await page.route("**/api/conversations/*/images/*?*", async (route) => {
    ids.push(route.request().url());
    await route.continue();
  });
  await page
    .getByRole("button", { name: "同じ画像で再試行", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "同じ画像で再試行", exact: true }),
  ).toHaveCount(0);
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  await page
    .getByRole("button", { name: "retry.pngを外す", exact: true })
    .click();
  await expect(page.locator(".draft-images img")).toHaveCount(0);
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

test("狭い画面でも作品を選び、チャットと右タブを切り替えられる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "作品を作成", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "作品を作成" });
  await dialog.getByLabel("作品名", { exact: true }).fill("狭い画面の作品");
  await dialog.getByRole("button", { name: "作品を作成", exact: true }).click();
  await page
    .getByRole("button", {
      name: "狭い画面の作品に新しいチャット",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "右タブを表示", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "タブを開く", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "チャットに戻る", exact: true })
    .click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "作品を選択", exact: true }).click();
  await page
    .getByRole("dialog", { name: "作品を選択" })
    .getByRole("button", { name: "狭い画面の作品", exact: true })
    .click();
  await page
    .getByRole("button", { name: "未命名のチャット 1", exact: true })
    .click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toBeVisible();
});
