import { expect, test } from "@playwright/test";
import type {
  Browser,
  BrowserContext,
  Page,
  WebSocketRoute,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appUrl = "http://127.0.0.1:4173";
const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../../evidence/phase-4/screenshots",
);

const liveBadge = '.connection-badge[data-connection="live"]';

async function saveScreenshot(page: Page, name: string) {
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDirectory, `${name}.png`) });
}

type Transport = {
  outage: boolean;
  current: WebSocketRoute | null;
};

async function openClient(
  browser: Browser,
  options: { interceptSocket?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page; transport: Transport }> {
  const context = await browser.newContext({
    baseURL: appUrl,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const transport: Transport = { outage: false, current: null };

  if (options.interceptSocket) {
    // The socket still talks to the real API through connectToServer(); the
    // route only lets the test pull the transport out from under the client.
    await page.routeWebSocket(/\/conversations\/[^/]+\/events$/, (socket) => {
      if (transport.outage) {
        void socket.close({ code: 1001, reason: "simulated outage" });
        return;
      }

      transport.current = socket;
      socket.connectToServer();
    });
  }

  const messagesLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/conversations\/[^/]+\/messages$/.test(response.url()),
  );

  await page.goto("/");
  await messagesLoaded;
  await expect(page.locator(".chat-title")).toContainText("engineering");
  await expect(page.locator(liveBadge)).toBeVisible();

  return { context, page, transport };
}

async function sendCommit(page: Page, text: string) {
  await page
    .getByPlaceholder('git commit -m "message"')
    .fill(`git commit -m "${text}"`);
  await page.getByRole("button", { name: "Send command" }).click();
}

async function createChannel(page: Page, name: string) {
  await page.getByRole("button", { name: "New channel" }).click();
  await page.getByLabel("Channel name").fill(name);
  await page.getByRole("button", { name: "Create channel" }).click();

  await expect(page.locator(".chat-title")).toContainText(name);
  await expect(page.locator(liveBadge)).toBeVisible();
}

async function openChannel(page: Page, name: string) {
  await page.locator(".conversation-item").filter({ hasText: name }).click();

  await expect(page.locator(".chat-title")).toContainText(name);
  await expect(page.locator(liveBadge)).toBeVisible();
}

function messageRow(page: Page, text: string) {
  return page.locator(".message-row").filter({ hasText: text });
}

function messageText(page: Page, text: string) {
  return page.getByRole("main").getByText(text, { exact: true });
}

test("a commit from one client is delivered to another client and survives a reload", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-four-live-${stamp}`;
  const text = `phase four live ${stamp}`;
  const sender = await openClient(browser);
  let receiver: Awaited<ReturnType<typeof openClient>> | null = null;

  try {
    // A dedicated conversation keeps this proof independent of the other tests
    // that write to `engineering` in parallel.
    await createChannel(sender.page, channelName);
    receiver = await openClient(browser);
    await openChannel(receiver.page, channelName);

    await sendCommit(sender.page, text);

    await expect(messageText(sender.page, text)).toBeVisible();

    // The receiver was already open and is never reloaded before this check.
    await expect(messageText(receiver.page, text)).toHaveCount(1, {
      timeout: 15_000,
    });

    const senderId = await messageRow(sender.page, text)
      .locator(".commit-id")
      .innerText();
    const receiverId = await messageRow(receiver.page, text)
      .locator(".commit-id")
      .innerText();

    expect(senderId).toBe(receiverId);
    expect(senderId).toMatch(/^[0-9a-f]{8}$/);

    await saveScreenshot(sender.page, "live-sender");
    await saveScreenshot(receiver.page, "live-receiver-no-reload");

    await receiver.page.reload();
    await openChannel(receiver.page, channelName);

    await expect(messageText(receiver.page, text)).toHaveCount(1, {
      timeout: 15_000,
    });

    const reloadedId = await messageRow(receiver.page, text)
      .locator(".commit-id")
      .innerText();

    expect(reloadedId).toBe(receiverId);

    await saveScreenshot(receiver.page, "live-receiver-after-reload");
  } finally {
    await sender.context.close();
    await receiver?.context.close();
  }
});

test("a client that goes offline catches up exactly once when it returns", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-four-reconnect-${stamp}`;
  const text = `phase four reconnect ${stamp}`;
  const sender = await openClient(browser);
  let receiver: Awaited<ReturnType<typeof openClient>> | null = null;

  try {
    await createChannel(sender.page, channelName);
    receiver = await openClient(browser, { interceptSocket: true });
    await openChannel(receiver.page, channelName);

    await receiver.context.setOffline(true);
    receiver.transport.outage = true;
    await receiver.transport.current?.close({
      code: 1001,
      reason: "simulated outage",
    });

    await expect(receiver.page.locator(liveBadge)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(
      receiver.page.locator('.connection-badge[data-connection="offline"]'),
    ).toBeVisible();
    await saveScreenshot(receiver.page, "reconnect-client-offline");

    // The sender commits while the receiver has no transport at all.
    await sendCommit(sender.page, text);
    await expect(messageText(sender.page, text)).toBeVisible();

    await expect(messageText(receiver.page, text)).toHaveCount(0);
    await saveScreenshot(receiver.page, "reconnect-missed-while-offline");

    receiver.transport.outage = false;
    await receiver.context.setOffline(false);

    await expect(receiver.page.locator(liveBadge)).toBeVisible({
      timeout: 20_000,
    });
    await expect(messageText(receiver.page, text)).toHaveCount(1, {
      timeout: 20_000,
    });

    // Catch-up merges persisted history, so a second pass cannot duplicate it.
    await receiver.page.waitForTimeout(750);
    await expect(messageText(receiver.page, text)).toHaveCount(1);

    await saveScreenshot(receiver.page, "reconnect-caught-up-once");
  } finally {
    await sender.context.close();
    await receiver?.context.close();
  }
});

test("the connection indicator fits the mobile layout", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: appUrl,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  try {
    await page.goto("/");
    await expect(page.locator(liveBadge)).toBeVisible();

    const badge = await page.locator(".connection-badge").boundingBox();
    const header = await page.locator(".chat-header").boundingBox();

    expect(badge).not.toBeNull();
    expect(header).not.toBeNull();
    expect((badge?.x ?? 0) + (badge?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(header?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(80);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);

    await saveScreenshot(page, "mobile-connection-badge");
  } finally {
    await context.close();
  }
});

test("both clients show quickly sent commits in the same order", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-four-order-${stamp}`;
  const sender = await openClient(browser);
  let receiver: Awaited<ReturnType<typeof openClient>> | null = null;

  try {
    // A dedicated conversation keeps this ordering proof away from the other
    // tests, which run in parallel against the same API.
    await createChannel(sender.page, channelName);
    receiver = await openClient(browser);
    await openChannel(receiver.page, channelName);

    const texts = [1, 2, 3, 4, 5].map(
      (index) => `phase four order ${stamp} ${index}`,
    );

    for (const text of texts) {
      await sendCommit(sender.page, text);
    }

    for (const text of texts) {
      await expect(messageText(receiver.page, text)).toHaveCount(1, {
        timeout: 15_000,
      });
    }

    const sentOrder = await sender.page
      .locator(".message-text")
      .allTextContents();
    const receivedOrder = await receiver.page
      .locator(".message-text")
      .allTextContents();

    expect(receivedOrder).toEqual(sentOrder);
    expect(sentOrder).toEqual(texts);

    await saveScreenshot(sender.page, "ordering-sender");
    await saveScreenshot(receiver.page, "ordering-receiver");
  } finally {
    await sender.context.close();
    await receiver?.context.close();
  }
});
