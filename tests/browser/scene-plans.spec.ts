import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { chatFixture } from "../chat-fixture";
import { mcp, waitFor } from "../mcp-fixture";
import { choosePanel } from "./ui-helpers";

test("計画詳細で部品と仮説・判断を確認し、参照元と再読込後の計画へ到達できる", async ({
  page,
}) => {
  const f = await chatFixture(
    true,
    false,
    async (url) => ({
      url,
      status: 200,
      mime: "text/plain",
      bytes: Buffer.from("港の資料本文"),
    }),
    4521,
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
    const pageResult = await client.call("fetch_reference_page", {
      contextRef: c.contextRef,
      url: "https://example.org/harbor",
      purpose: "岸壁",
    });
    const ref = (
      await client.call("save_reference", {
        contextRef: c.contextRef,
        pageId: pageResult.result.page.id,
        title: "港の資料",
        element: "岸壁",
        intentRelation: "静けさ",
        usageTerms: "不明",
      })
    ).result.candidate;
    await waitFor(async () =>
      Boolean((await f.view()).requests.at(-1).terminal),
    );
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "「港の資料」を参考として選んで。静けさを表現するため。",
      role: "none",
    });
    c = await client.current();
    expect(
      (
        await client.call("select_reference", {
          contextRef: c.contextRef,
          sourceRequestId: c.sourceRequestId,
          referenceId: ref.id,
        })
      ).result.complete,
    ).toBe(true);
    await waitFor(async () =>
      Boolean((await f.view()).requests.at(-1).terminal),
    );
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "港の計画を作って",
      role: "planning",
    });
    c = await client.current();
    const plan = (
      await client.call("save_scene_plan", {
        contextRef: c.contextRef,
        title: "港の計画",
        body: "岸壁から倉庫へ視線を誘導する。",
        referenceIds: [ref.id],
        parts: [
          {
            id: "quay",
            name: "岸壁",
            placement: "手前",
            dimensions: "幅10m、高さ2m（概寸）",
            order: 1,
          },
        ],
        hypotheses: [
          {
            id: "back",
            body: "裏側も石造",
            evidence: "正面から推測",
            missing: "裏面の写真なし",
          },
        ],
      })
    ).result.plan;
    expect(plan.fixed.context.references.selected[0].id).toBe(ref.id);
    await waitFor(async () =>
      Boolean((await f.view()).requests.at(-1).terminal),
    );
    await f.listen();
    await page.goto("http://localhost:4521/");
    await page.getByRole("button", { name: "試験作品", exact: true }).click();
    await page
      .getByRole("button", { name: "未命名のチャット 1", exact: true })
      .click();
    await page
      .getByRole("region", { name: "シーン計画のリンク" })
      .getByRole("button", { name: "港の計画 ↗", exact: true })
      .click();
    const panel = page.getByRole("article", { name: "シーン計画の詳細" });
    await expect(panel.getByText("概寸：幅10m、高さ2m（概寸）")).toBeVisible();
    await expect(panel.getByText("不足：裏面の写真なし")).toBeVisible();
    await expect(
      panel.getByText("判断状態：未採用", { exact: true }),
    ).toHaveCount(2);
    await f.post(`/api/conversations/${f.chat.id}/messages`, {
      body: "「港の計画」を採用して。構図が合うため。",
      role: "none",
    });
    c = await client.current();
    await client.call("record_human_decision", {
      contextRef: c.contextRef,
      sourceRequestId: c.sourceRequestId,
      planId: plan.id,
    });
    await expect(
      panel.getByText("判断状態：採用", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByText("判断状態：未採用", { exact: true }),
    ).toHaveCount(1);
    await panel
      .getByRole("button", { name: "港の資料 ↗", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "参考資料の詳細" })
        .getByRole("heading", { name: "港の資料" }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "試験作品", exact: true }).click();
    await page
      .getByRole("button", {
        name: /^(未命名のチャット 1|港の光の検討)$/,
        exact: true,
      })
      .click();
    await choosePanel(page, "シーン計画");
    await page
      .getByRole("tabpanel")
      .filter({ visible: true })
      .getByRole("button", { name: "港の計画 ↗", exact: true })
      .click();
    await expect(
      panel.getByText("判断状態：採用", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/issue-66-plan.png",
      fullPage: true,
    });
  } finally {
    client?.close();
    await f.close();
  }
});
