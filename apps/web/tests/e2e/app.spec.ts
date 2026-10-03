import { expect, test, type Page } from "@playwright/test";

const apiUrl = "http://localhost:3000";
const initialMessages = [
  {
    id: "playwright-seed",
    author: "rahul",
    text: "Ready to ship?",
    command: "git commit",
    created_at: "2026-10-03T08:42:00.000Z",
  },
];

async function openApp(
  page: Page,
  viewport?: { width: number; height: number },
) {
  const submittedCommands: string[] = [];

  if (viewport) {
    await page.setViewportSize(viewport);
  }

  await page.route(`${apiUrl}/**`, async (route) => {
    const request = route.request();
    const origin = request.headers().origin ?? "http://127.0.0.1:4173";
    const corsHeaders = {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    const { pathname } = new URL(request.url());

    if (request.method() === "GET" && pathname === "/messages") {
      await route.fulfill({
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify(initialMessages),
      });
      return;
    }

    if (request.method() === "POST" && pathname === "/commands") {
      const body = request.postDataJSON() as {
        input?: string;
        author?: string;
      };
      const input = body.input ?? "";
      const messageMatch = input.match(/(?:-m|--message)\s+["'](.*?)["']\s*$/);
      const text = messageMatch?.[1] ?? input;

      submittedCommands.push(input);

      await route.fulfill({
        status: 201,
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            id: `playwright-${submittedCommands.length}`,
            author: body.author ?? "grok08",
            text,
            command: "git commit",
            createdAt: "2026-10-03T08:43:00.000Z",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({ error: "Unhandled test API request" }),
    });
  });

  await page.goto("/");
  return submittedCommands;
}

test("loads messages from the API fixture", async ({ page }) => {
  await openApp(page);

  await expect(page.getByText("Ready to ship?", { exact: true })).toBeVisible();
  await expect(page.getByText('git commit -m "Ready to ship?"')).toBeVisible();
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