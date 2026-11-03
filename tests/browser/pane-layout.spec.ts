import { openWorkDialog } from "./ui-helpers";
import { test, expect } from "@playwright/test";

test("一覧は最小幅で一度止まってから折りたたみ、戻せる", async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 960 });
  await page.goto("/");
  await page.clock.install({ time: new Date("2026-11-03T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-03T00:00:01Z"));
  const handle = page.getByRole("separator", { name: "作品一覧の幅" });
  const box = (await handle.boundingBox())!;
  const minimum = Number(await handle.getAttribute("aria-valuemin"));
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(minimum - 30, box.y + 100);
  await expect(handle).toHaveAttribute("aria-valuenow", String(minimum));
  await page.clock.runFor(179);
  await expect(page.locator(".brand-name")).toBeVisible();
  await page.clock.runFor(1);
  await expect(
    page.getByRole("button", { name: "チャット一覧を表示", exact: true }),
  ).toBeVisible();
  await page.mouse.up();
  await page.screenshot({ path: "test-results/issue-102-collapsed-pane.png" });
  await page
    .getByRole("button", { name: "チャット一覧を表示", exact: true })
    .click();
  await expect(page.locator(".brand-name")).toBeVisible();
  await expect(handle).toHaveAttribute("aria-valuenow", String(minimum));
});

test("各入力要素は最小幅でも一列に収まり、メインと右タブを折りたたんで戻せる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 960 });
  await page.goto("/");
  await openWorkDialog(page);
  await page.getByLabel("作品名", { exact: true }).fill("幅調整の作品");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "作品を作成", exact: true })
    .click();
  await page
    .getByRole("button", { name: "幅調整の作品に新しいチャット", exact: true })
    .click();
  const handle = page.getByRole("separator", { name: "チャットと右タブの幅" });
  await handle.focus();
  await page.keyboard.press("Home");
  const controls = page.locator(".main-chat .composer-tools");
  expect(
    await controls.evaluate((row) => row.scrollWidth <= row.clientWidth),
  ).toBe(true);
  const selectRows = await page
    .locator(".main-chat .composer-selects select")
    .evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().y)),
    );
  expect(new Set(selectRows).size).toBe(1);
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("幅を戻しても入力を保持");
  let box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + 100);
  await expect(
    page.getByRole("button", { name: "メインチャットを表示", exact: true }),
  ).toBeVisible();
  await page.mouse.up();
  await page
    .getByRole("button", { name: "メインチャットを表示", exact: true })
    .click();
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveValue(
    "幅を戻しても入力を保持",
  );
  await handle.focus();
  await page.keyboard.press("End");
  box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 100);
  await expect(
    page.getByRole("button", { name: "右タブを表示", exact: true }),
  ).toBeVisible();
  await page.mouse.up();
  await page.getByRole("button", { name: "右タブを表示", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "新しいタブ", exact: true }),
  ).toBeVisible();
  const tabGutters = await page.locator(".tab-chooser").evaluate((content) => {
    const child = content.getBoundingClientRect();
    const parent = content.closest(".panel-content")!.getBoundingClientRect();
    return [child.left - parent.left, parent.right - child.right];
  });
  expect(Math.abs(tabGutters[0]! - tabGutters[1]!)).toBeLessThan(2);
  // Expanding the viewport gives content equal gutters on both sides.
  await page.setViewportSize({ width: 2200, height: 960 });
  await expect
    .poll(async () => Number(await handle.getAttribute("aria-valuemax")))
    .toBeGreaterThan(1500);
  await handle.focus();
  await page.keyboard.press("End");
  const gutters = await page
    .locator(".main-chat .composer-area")
    .evaluate((content) => {
      const child = content.getBoundingClientRect();
      const parent = content.closest(".main-chat")!.getBoundingClientRect();
      return [child.left - parent.left, parent.right - child.right];
    });
  expect(gutters[0]).toBeGreaterThan(100);
  expect(Math.abs(gutters[0]! - gutters[1]!)).toBeLessThan(2);
  await page.screenshot({ path: "test-results/issue-102-pane-layout.png" });
});

test("最小幅から戻したドラッグや終了したドラッグは遅れて折りたたまれない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 960 });
  await page.goto("/");
  await page.clock.install({ time: new Date("2026-11-03T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-03T00:00:01Z"));
  const handle = page.getByRole("separator", { name: "作品一覧の幅" });
  const box = (await handle.boundingBox())!;
  const minimum = Number(await handle.getAttribute("aria-valuemin"));
  await page.mouse.move(box.x + 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(minimum - 30, box.y + 100);
  await expect(handle).toHaveAttribute("aria-valuenow", String(minimum));
  await page.clock.runFor(100);
  await expect(page.locator(".brand-name")).toBeVisible();
  await page.mouse.move(minimum + 30, box.y + 100);
  await page.clock.runFor(200);
  await expect(page.locator(".brand-name")).toBeVisible();
  await page.mouse.move(minimum - 30, box.y + 100);
  await page.mouse.up();
  await page.clock.runFor(200);
  await expect(page.locator(".brand-name")).toBeVisible();
});

test("狭いデスクトップとモバイルを往復しても、領域が画面からはみ出さない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 960 });
  await page.goto("/");
  for (const width of [1000, 810, 760, 1512]) {
    await page.setViewportSize({ width, height: 960 });
    await expect
      .poll(() =>
        page
          .locator(".workspace")
          .evaluate((item) => Math.round(item.getBoundingClientRect().right)),
      )
      .toBe(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const main = page.locator(".main-chat");
    if (width > 800) {
      const actual = (await main.boundingBox())!.width;
      const minimum = Number(
        await page
          .getByRole("separator", { name: "チャットと右タブの幅" })
          .getAttribute("aria-valuemin"),
      );
      expect(actual).toBeGreaterThanOrEqual(minimum);
    } else {
      await expect(
        page.getByRole("button", { name: "右タブを表示", exact: true }),
      ).toBeVisible();
    }
  }
});
