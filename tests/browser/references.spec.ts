import { test, expect } from "@playwright/test";
import { chatFixture } from "../chat-fixture";
import { mcp, waitFor } from "../mcp-fixture";
import { choosePanel } from "./ui-helpers";
import { resolve } from "node:path";

test("参考画像20件をグリッド表示し、成果物と共通の拡大プレビューと利用条件・選択を開き直す", async ({
  page,
}) => {
  const f = await chatFixture(
    true,
    true,
    async (url) =>
      url.endsWith(".png")
        ? {
            url,
            status: 200,
            mime: "image/png",
            bytes: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
              "base64",
            ),
          }
        : {
            url,
            status: 200,
            mime: "text/plain",
            bytes: Buffer.from("Harbor reference text"),
          },
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
        usageTerms: "不明（ページに記載なし）",
        element: "岸壁の構造",
        intentRelation: "静かな港",
        imageUrl: "https://example.org/harbor.png",
      })
    ).result.candidate;
    await Promise.all(
      Array.from({ length: 19 }, (_, i) =>
        client!
          .call("save_reference", {
            contextRef: c.contextRef,
            pageId: source.id,
            title: `参考画像 ${i + 2}`,
            element: "岸壁",
            intentRelation: "港の構造",
            usageTerms: "個人の参考用、制作への利用条件は不明",
            imageUrl: `https://example.org/harbor-${i + 2}.png`,
          })
          .then((result) =>
            expect(result.result?.candidate.image.status).toBe("stored"),
          ),
      ),
    );
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
    await expect(panel.locator(".preview-canvas img")).toBeVisible();
    await expect
      .poll(() =>
        panel
          .locator(".preview-canvas img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await panel.getByRole("button", { name: "拡大", exact: true }).click();
    await expect(panel.getByText("120%", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "フィット", exact: true }).click();
    await expect(panel.getByText("100%", { exact: true })).toBeVisible();
    await expect(
      panel.getByText("参考要素: 岸壁の構造", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("画像: 管理下に保存済み", { exact: true }),
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
    const gallery = page.getByRole("list", { name: "参考画像のグリッド" });
    await expect(gallery.getByRole("listitem")).toHaveCount(20);
    await expect(
      gallery.getByRole("img", { name: "港の資料", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/issue-65-reference-grid.png",
      fullPage: true,
    });
    await page
      .getByRole("region", { name: "参考資料の一覧" })
      .getByRole("button", { name: "港の資料", exact: true })
      .click();
    await expect(
      panel.getByText("参考として選択済み", { exact: true }),
    ).toBeVisible();
    await panel.locator(".preview-canvas").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/issue-65-reference-panel.png",
      fullPage: true,
    });
  } finally {
    client?.close();
    await f.close();
  }
});
