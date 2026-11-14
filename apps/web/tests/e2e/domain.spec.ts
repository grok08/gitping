import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../../evidence/phase-2/screenshots",
);

async function saveScreenshot(page: Page, name: string) {
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`) });
}

test("a commit typed in the browser is persisted through the domain model", async ({
  page,
}) => {
  const text = `phase two persists ${Date.now()}`;

  await page.goto("/");
  await expect(page.locator(".chat-title")).toContainText("engineering");

  await page
    .getByPlaceholder('git commit -m "message"')
    .fill(`git commit -m "${text}"`);
  await page.getByRole("button", { name: "Send command" }).click();

  await expect(
    page.getByRole("main").getByText(text, { exact: true }),
  ).toBeVisible();

  await saveScreenshot(page, "commit-rendered");

  await page.reload();

  await expect(
    page.getByRole("main").getByText(text, { exact: true }),
  ).toBeVisible();

  await saveScreenshot(page, "commit-reloaded-from-sqlite");
});

test("the real API rejects a command that is not a message", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder('git commit -m "message"').fill("git log");
  await page.getByRole("button", { name: "Send command" }).click();

  await expect(page.locator(".command-error")).toContainText(
    'For the first message flow, use: git commit -m "message"',
  );

  await saveScreenshot(page, "api-rejection");
});
