import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appUrl = "http://127.0.0.1:4173";
const apiUrl = "http://localhost:3000";
const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../../evidence/phase-4/screenshots",
);

const liveBadge = '.connection-badge[data-connection="live"]';
const composer = 'git commit -m "message"';
const commandUrl = /\/conversations\/[^/]+\/commands$/;

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

test("a retry after a lost response resolves to the commit the server already stored", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-four-idempotent-${stamp}`;
  const text = `idempotent retry ${stamp}`;
  const command = `git commit -m "${text}"`;
  const context = await browser.newContext({
    baseURL: appUrl,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    await openClient(page);

    // A dedicated channel keeps the row counts in this proof independent of
    // the parallel tests that write to `engineering`.
    await page.getByRole("button", { name: "New channel" }).click();
    await page.getByLabel("Channel name").fill(channelName);
    await page.getByRole("button", { name: "Create channel" }).click();

    await expect(page.locator(".chat-title")).toContainText(channelName);
    await expect(page.locator(liveBadge)).toBeVisible();

    let dropNextResponse = true;

    await page.route(commandUrl, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      if (!dropNextResponse) {
        await route.continue();
        return;
      }

      dropNextResponse = false;

      // The request is real and only the response is dropped. `route.fetch()`
      // sends the POST to the real API, so the commit is written to SQLite and
      // broadcast; `route.abort()` then fails the page's fetch, which is the
      // lost-response case. Nothing here is mocked.
      await route.fetch();
      await route.abort();
    });

    await page.getByPlaceholder(composer).fill(command);
    await page.getByRole("button", { name: "Send command" }).click();

    // The browser saw a network failure, so the error is shown and the
    // composer still holds the text. That is what makes the next click a
    // retry of the same intent.
    await expect(page.locator(".command-error")).toBeVisible();
    await expect(page.getByPlaceholder(composer)).toHaveValue(command);

    await saveScreenshot(page, "idempotent-lost-response-keeps-text");

    await page.getByRole("button", { name: "Send command" }).click();

    await expect(page.locator(".command-error")).toHaveCount(0);

    const rows = page.locator(".message-row").filter({ hasText: text });

    await expect(rows).toHaveCount(1);
    await expect(rows.locator(".commit-id")).toHaveCount(1);

    const commitId = await rows.locator(".commit-id").innerText();

    expect(commitId).toMatch(/^[0-9a-f]{8}$/);

    await saveScreenshot(page, "idempotent-retry-after-lost-response");

    // The UI is the claim; SQLite is the proof. One message row, and the
    // retry resolved to the commit the first attempt already stored.
    const conversations = (await (
      await page.request.get(`${apiUrl}/conversations`)
    ).json()) as Array<{ id: string; name: string }>;
    const channel = conversations.find((item) => item.name === channelName);

    expect(channel).toBeDefined();

    const stored = (await (
      await page.request.get(`${apiUrl}/conversations/${channel?.id}/messages`)
    ).json()) as Array<{ id: string; text: string }>;

    expect(stored).toHaveLength(1);
    expect(stored[0]?.text).toBe(text);
    expect(stored[0]?.id.startsWith(commitId)).toBe(true);
  } finally {
    await context.close();
  }
});
