import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../../evidence/phase-3/screenshots",
);

async function saveScreenshot(page: Page, name: string) {
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`) });
}

test("a channel created in the browser and its commit survive a reload", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-three-${stamp}`;
  const text = `phase three persists ${stamp}`;

  await page.goto("/");
  await expect(page.locator(".conversation-item").first()).toBeVisible();

  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByLabel("Channel name").fill(channelName);
  await page.getByRole("button", { name: "Create channel" }).click();

  await expect(page.locator(".chat-title")).toContainText(channelName);
  await expect(
    page.locator(".conversation-item").filter({ hasText: channelName }),
  ).toBeVisible();

  await saveScreenshot(page, "channel-created");

  await page
    .getByPlaceholder('git commit -m "message"')
    .fill(`git commit -m "${text}"`);
  await page.getByRole("button", { name: "Send command" }).click();

  await expect(
    page.getByRole("main").getByText(text, { exact: true }),
  ).toBeVisible();

  await saveScreenshot(page, "commit-in-new-channel");

  await page.reload();

  const reloadedChannel = page
    .locator(".conversation-item")
    .filter({ hasText: channelName });

  await expect(reloadedChannel).toBeVisible();
  await reloadedChannel.click();

  await expect(page.locator(".chat-title")).toContainText(channelName);
  await expect(
    page.getByRole("main").getByText(text, { exact: true }),
  ).toBeVisible();

  await saveScreenshot(page, "channel-and-commit-after-reload");
});

test("a direct conversation created in the browser survives a reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".conversation-item").first()).toBeVisible();

  await page.getByRole("button", { name: "New direct message" }).click();
  await page.getByLabel("GitHub username").fill("maria");
  await page.getByRole("button", { name: "Start conversation" }).click();

  await expect(page.locator(".chat-title")).toContainText("maria");

  const directConversation = page
    .locator(".conversation-item")
    .filter({ hasText: "maria" });

  await expect(directConversation).toBeVisible();

  await saveScreenshot(page, "direct-message-created");

  await page.reload();

  const reloadedDirect = page
    .locator(".conversation-item")
    .filter({ hasText: "maria" });

  await expect(reloadedDirect).toBeVisible();
  await reloadedDirect.click();

  await expect(page.locator(".chat-title")).toContainText("maria");

  await saveScreenshot(page, "direct-message-after-reload");
});
