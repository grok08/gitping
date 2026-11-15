import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { openApp } from "./mock-api";

test.skip(
  Boolean(process.env.CI),
  "visual parity screenshots are recorded and compared on the maintainer machine",
);

const evidenceDirectory = process.env.EVIDENCE_DIR
  ? resolve(import.meta.dirname, "../../../../evidence", process.env.EVIDENCE_DIR)
  : null;

async function capture(page: Page, name: string) {
  if (evidenceDirectory) {
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`) });
  }

  await expect(page).toHaveScreenshot(`${name}.png`);
}

test("desktop light conversation", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await expect(page.locator(".chat-title")).toContainText("engineering");

  await capture(page, "desktop-light");
});

test("desktop dark conversation", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await capture(page, "desktop-dark");
});

test("collapsed conversation sidebar", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await page
    .getByRole("button", { name: "Collapse conversation sidebar" })
    .click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);

  await capture(page, "sidebar-collapsed");
});

test("workspace members panel", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await page.getByRole("button", { name: "Workspace members" }).click();
  await expect(page.locator(".side-panel")).toBeVisible();

  await capture(page, "workspace-members-panel");
});

test("settings modal", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".modal")).toBeVisible();

  await capture(page, "settings-modal");
});

test("conversation search with results", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await page
    .getByRole("button", { name: "Search this conversation" })
    .click();
  await page.getByPlaceholder("Search in #engineering").fill("Ready");
  await expect(page.locator(".chat-search-count")).toHaveText("1 result");

  await capture(page, "conversation-search");
});

test("mobile drawer open", async ({ page }) => {
  await openApp(page, { width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-open/);

  await capture(page, "mobile-drawer");
});

test("search palette idle", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await page.keyboard.press("Control+k");
  await expect(page.locator(".search-palette")).toBeVisible();

  await capture(page, "search-palette-idle");
});

test("search palette with results", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await page.keyboard.press("Control+k");
  await page.locator(".search-palette input").fill("Ready");
  await expect(page.locator(".search-hit").first()).toBeVisible();

  await capture(page, "search-palette-results");
});

test("branch switch notice", async ({ page }) => {
  await openApp(page, { width: 1280, height: 800 });
  await page.locator(".branch-button").click();
  await page
    .locator(".branch-menu button")
    .filter({ hasText: "weekend" })
    .click();

  const notice = page.locator(".dynamic-island");
  await expect(notice).toContainText("weekend");

  if (evidenceDirectory) {
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(evidenceDirectory, "branch-notice.png"),
    });
  }
});
