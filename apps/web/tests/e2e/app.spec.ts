import { expect, test } from "@playwright/test";
import { openApp } from "./mock-api";

test("loads messages from the API fixture", async ({ page }) => {
  await openApp(page);

  await expect(
    page.getByRole("main").getByText("Ready to ship?", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText('git commit -m "Ready to ship?"'),
  ).toBeVisible();
});

test("sends a Git command and renders the returned message", async ({ page }) => {
  const submittedCommands = await openApp(page);
  const composer = page.getByPlaceholder('git commit -m "message"');

  await composer.fill('git commit -m "Automated message"');
  await page.getByRole("button", { name: "Send command" }).click();

  await expect(
    page.getByRole("main").getByText("Automated message", { exact: true }),
  ).toBeVisible();
  expect(submittedCommands).toEqual(['git commit -m "Automated message"']);
});

test("creates and opens a channel", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByLabel("Channel name").fill("architecture");
  await page.getByRole("button", { name: "Create channel" }).click();

  await expect(page.locator(".chat-title")).toContainText("architecture");
  await expect(
    page.locator(".conversation-item").filter({ hasText: "architecture" }),
  ).toBeVisible();
});

test("closes dialogs and side panels after their exit transitions", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "Settings" }).click();
  const modal = page.locator(".modal-backdrop");
  await expect(modal).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(modal).toHaveCount(0);

  await page.getByRole("button", { name: "Notifications" }).click();
  const panel = page.locator(".side-panel");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(panel).toHaveCount(0);
});

test("keeps the branch notice centered in chat as the sidebar changes", async ({ page }) => {
  await openApp(page);

  await page.locator(".branch-button").click();
  await page.locator(".branch-menu button").filter({ hasText: "weekend" }).click();

  const notice = page.locator(".dynamic-island");
  const centerOffset = async () => {
    const noticeBox = await notice.boundingBox();
    const chatBox = await page.locator(".chat-panel").boundingBox();

    if (!noticeBox || !chatBox) {
      return Number.POSITIVE_INFINITY;
    }

    const noticeCenter = noticeBox.x + noticeBox.width / 2;
    return Math.abs(noticeCenter - (chatBox.x + chatBox.width / 2));
  };

  await expect(notice).toBeVisible();
  await expect.poll(centerOffset).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Collapse conversation sidebar" }).click();
  await expect.poll(centerOffset).toBeLessThanOrEqual(1);
});

test("opens the mobile drawer and closes it when a conversation is selected", async ({ page }) => {
  await openApp(page, { width: 390, height: 844 });

  await expect(page.locator(".app-shell")).not.toHaveClass(/sidebar-open/);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-open/);

  await page.locator(".conversation-item").filter({ hasText: "general" }).click();

  await expect(page.locator(".chat-title")).toContainText("general");
  await expect(page.locator(".app-shell")).not.toHaveClass(/sidebar-open/);
});
