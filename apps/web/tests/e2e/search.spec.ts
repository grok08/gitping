import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../../evidence/phase-7/screenshots",
);

const liveBadge = '.connection-badge[data-connection="live"]';
const composerPlaceholder = 'git commit -m "message"';

async function saveScreenshot(page: Page, name: string) {
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`) });
}

async function openClient(page: Page) {
  const messagesLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/conversations\/[^/]+\/messages$/.test(response.url()),
  );

  await page.goto("/");
  await messagesLoaded;
  await expect(page.locator(".chat-title")).toContainText("engineering");
  await expect(page.locator(liveBadge)).toBeVisible();
}

function composer(page: Page) {
  return page.getByPlaceholder(composerPlaceholder);
}

async function sendCommand(page: Page, input: string) {
  await composer(page).fill(input);
  await page.getByRole("button", { name: "Send command" }).click();
}

async function createChannel(page: Page, name: string) {
  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByLabel("Channel name").fill(name);
  await page.getByRole("button", { name: "Create channel" }).click();

  await expect(page.locator(".chat-title")).toContainText(name);
  await expect(page.locator(liveBadge)).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 6000 });
}

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Search workspace" });
}

function paletteInput(page: Page) {
  return palette(page).getByRole("combobox");
}

async function openPalette(page: Page) {
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
}

test("finds a message from the palette and opens it", async ({ page }) => {
  const channel = `palette-${Date.now()}`;

  await openClient(page);
  await createChannel(page, channel);
  await sendCommand(page, 'git commit -m "Ship the palette search"');
  await expect(
    page.locator(".message-row").filter({ hasText: "Ship the palette search" }),
  ).toBeVisible();

  await openPalette(page);
  await paletteInput(page).fill("palette search");

  const firstHit = palette(page).getByRole("option").first();
  await expect(firstHit).toContainText("Ship the palette search");
  await expect(firstHit).toContainText(`#${channel}`);
  await saveScreenshot(page, "palette-results");

  await paletteInput(page).press("Enter");

  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator(".chat-title")).toContainText(channel);
  await expect(page.locator(".message-row.is-highlighted")).toContainText(
    "Ship the palette search",
  );
  await saveScreenshot(page, "message-jump-highlight");
});

test("reads filters and rejects a malformed one", async ({ page }) => {
  const channel = `filters-${Date.now()}`;

  await openClient(page);
  await createChannel(page, channel);
  await sendCommand(page, 'git commit -m "deploy the login fix"');
  await expect(
    page.locator(".message-row").filter({ hasText: "deploy the login fix" }),
  ).toBeVisible();

  await openPalette(page);

  await paletteInput(page).fill("author:grok08 deploy");
  await expect(palette(page).locator(".search-chip")).toContainText([
    "author:grok08",
  ]);
  await expect(palette(page).getByRole("option").first()).toContainText(
    "deploy the login fix",
  );
  await saveScreenshot(page, "palette-filters");

  await paletteInput(page).fill("after:soon");
  await expect(palette(page).getByRole("alert")).toHaveText(
    "after: expects YYYY-MM-DD or an ISO timestamp",
  );
  await saveScreenshot(page, "palette-error");

  await paletteInput(page).fill("author:nobody zzz");
  await expect(palette(page).locator(".search-palette-status")).toContainText(
    'No matches for "zzz"',
  );
});

test("searches one conversation and labels a hit from another branch", async ({
  page,
}) => {
  const channel = `branches-${Date.now()}`;

  await openClient(page);
  await createChannel(page, channel);
  await sendCommand(page, 'git commit -m "main login note"');
  await sendCommand(page, "git branch weekend");
  await sendCommand(page, "git switch weekend");
  await expect(page.locator(".branch-button")).toContainText("weekend");
  await sendCommand(page, 'git commit -m "weekend login note"');
  await sendCommand(page, "git switch main");
  await expect(page.locator(".branch-button")).toContainText("main");

  await page
    .getByRole("button", { name: "Search this conversation" })
    .click();
  await page.getByPlaceholder(`Search in #${channel}`).fill("login");

  await expect(page.locator(".chat-search-count")).toHaveText("2 results");
  await expect(
    page.locator(".message-row").filter({ hasText: "weekend login note" }),
  ).toContainText("weekend");
  await saveScreenshot(page, "conversation-search-branch");
});

test("opens a conversation hit, a person hit, and a branch hit", async ({
  page,
}) => {
  const channel = `hits-${Date.now()}`;

  await openClient(page);
  await createChannel(page, channel);
  await sendCommand(page, 'git commit -m "branch hit seed"');
  await sendCommand(page, "git branch release");

  await openPalette(page);
  await paletteInput(page).fill(channel);
  await palette(page)
    .getByRole("group", { name: "Conversations" })
    .getByRole("option")
    .first()
    .click();
  await expect(palette(page)).toHaveCount(0);
  await expect(page.locator(".chat-title")).toContainText(channel);

  await openPalette(page);
  await paletteInput(page).fill("rahul");
  await palette(page)
    .getByRole("group", { name: "People" })
    .getByRole("option")
    .first()
    .click();
  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel("GitHub username")).toHaveValue("rahul");

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(modal).toHaveCount(0);

  await openPalette(page);
  await paletteInput(page).fill("release");
  await palette(page)
    .getByRole("group", { name: "Branches" })
    .getByRole("option")
    .first()
    .click();
  await expect(page.locator(".chat-title")).toContainText(channel);
  await expect(page.locator(".branch-button")).toContainText("release");
  await saveScreenshot(page, "branch-hit");
});

test("moves through results with the keyboard only", async ({ page }) => {
  await openClient(page);
  await openPalette(page);

  await paletteInput(page).fill("weekend");
  await expect(palette(page).locator("[role=option]").first()).toBeVisible();

  const first = await paletteInput(page).getAttribute("aria-activedescendant");

  await paletteInput(page).press("ArrowDown");
  const second = await paletteInput(page).getAttribute("aria-activedescendant");

  expect(first).not.toBe(second);
  expect(second).toMatch(/^search-palette-hit-\d+$/);

  await paletteInput(page).press("Escape");
  await expect(palette(page)).toHaveCount(0);
});

test("fits a 390 px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openClient(page);
  await openPalette(page);

  await paletteInput(page).fill("ship");
  await expect(palette(page)).toBeVisible();

  const box = await palette(page).boundingBox();

  expect(box?.width).toBe(390);
  await saveScreenshot(page, "palette-390");
});
