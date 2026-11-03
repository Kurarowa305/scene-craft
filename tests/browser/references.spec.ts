import { test, expect } from "@playwright/test";
import { chatFixture } from "../chat-fixture";
import { mcp, waitFor } from "../mcp-fixture";
import { choosePanel } from "./ui-helpers";
import { resolve } from "node:path";

test("チャットの参考リンクと右タブに出典・画像未保持・選択原文を再表示する", async ({
  page,
}) => {
  const f = await chatFixture(
    true,
    false,
    async (url) => ({
      url,
      status: 200,
      mime: "text/plain",
      bytes: Buffer.from("Harbor reference text"),
    }),
    4520,
    resolve("dist/client"),
  );
  let client: Awaited<ReturnType<typeof mcp>> | undefined;
  try {
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "参考資料を探して",
      role: "reference",
    });
    client = await mcp(f);
    let c = await client.current();
    const source = (
      await client.call("fetch_reference_page", {
        contextRef: c.contextRef,
        url: "https://example.org/harbor",
        purpose: "岸壁の構造",
      })
    ).result.page;
    const saved = (
      await client.call("save_reference", {
        contextRef: c.contextRef,
        pageId: source.id,
        title: "港の資料",
        element: "岸壁の構造",
        intentRelation: "静かな港",
        imageUrl: "https://example.org/harbor.jpg",
      })
    ).result.candidate;
    await waitFor(async () =>
      Boolean((await f.view()).requests.at(-1).terminal),
    );
    await f.listen();
    await page.goto("http://localhost:4520/");
    await page.getByRole("button", { name: "試験作品", exact: true }).click();
    await page
      .getByRole("button", { name: "未命名のチャット 1", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "参考資料のリンク" })
        .getByRole("button", { name: "港の資料", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("region", { name: "参考資料のリンク" })
      .getByRole("button", { name: "港の資料", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "港の資料", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("region", { name: "参考資料の詳細" });
    await expect(
      panel.getByText("参考要素: 岸壁の構造", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("画像: 画像未保持（保存条件未確認）", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("未選択（不採用ではありません）", { exact: true }),
    ).toBeVisible();
    const r = await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "「港の資料」を参考として選んで。静けさを表現するため。",
    });
    c = await client.current();
    expect(
      (
        await client.call("select_reference", {
          contextRef: c.contextRef,
          sourceRequestId: r.id,
          referenceId: saved.id,
        })
      ).result.complete,
    ).toBe(true);
    await expect(
      panel.getByText(
        "「港の資料」を参考として選んで。静けさを表現するため。",
        { exact: true },
      ),
    ).toBeVisible();
    await panel.getByText("取得した本文", { exact: true }).click();
    await expect(
      panel.getByText("Harbor reference text", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "港の資料を閉じる", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "港の資料", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("region", { name: "参考資料のリンク" })
      .getByRole("button", { name: "港の資料", exact: true })
      .click();
    await expect(
      panel.getByText("参考として選択済み", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "試験作品", exact: true }).click();
    await page
      .getByRole("button", { name: "未命名のチャット 1", exact: true })
      .click();
    await choosePanel(page, "参考資料");
    await page
      .getByRole("region", { name: "参考資料の一覧" })
      .getByRole("button", { name: "港の資料", exact: true })
      .click();
    await expect(
      panel.getByText("参考として選択済み", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/issue-65-reference-panel.png",
      fullPage: true,
    });
  } finally {
    client?.close();
    await f.close();
  }
});
