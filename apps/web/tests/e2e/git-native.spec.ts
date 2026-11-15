import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appUrl = "http://127.0.0.1:4173";
const apiUrl = "http://localhost:3000";
const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../../evidence/phase-5/screenshots",
);

const liveBadge = '.connection-badge[data-connection="live"]';
const composer = 'git commit -m "message"';

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

async function openClientContext(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: appUrl,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  await openClient(page);

  return { context, page };
}

async function sendCommand(page: Page, input: string) {
  await page.getByPlaceholder(composer).fill(input);
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

function branchButton(page: Page) {
  return page.locator(".branch-button");
}

async function conversationId(page: Page, name: string): Promise<string> {
  const conversations = (await (
    await page.request.get(`${apiUrl}/conversations`)
  ).json()) as Array<{ id: string; name: string }>;
  const conversation = conversations.find((item) => item.name === name);

  expect(conversation).toBeDefined();

  return conversation?.id ?? "";
}

test("git switch -c persists the new branch as the member's context", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-five-switch-${stamp}`;
  const { context, page } = await openClientContext(browser);

  try {
    await createChannel(page, channelName);
    await sendCommand(page, `git commit -m "base work ${stamp}"`);
    await expect(messageText(page, `base work ${stamp}`)).toBeVisible();

    await sendCommand(page, "git switch -c release");

    // The response carries the new list, so the selector follows the server
    // rather than a local guess.
    await expect(branchButton(page)).toContainText("release");
    await saveScreenshot(page, "switch-created-branch");

    const id = await conversationId(page, channelName);
    const branches = (await (
      await page.request.get(`${apiUrl}/conversations/${id}/branches`)
    ).json()) as Array<{ name: string; current: boolean }>;

    expect(branches.find((branch) => branch.current)?.name).toBe("release");

    await page.reload();
    await openChannel(page, channelName);

    await expect(branchButton(page)).toContainText("release");
    await saveScreenshot(page, "switch-branch-after-reload");

    // The restored context is where the next commit lands, which is the point
    // of persisting it.
    await sendCommand(page, `git commit -m "release work ${stamp}"`);
    await expect(messageText(page, `release work ${stamp}`)).toBeVisible();

    const after = (await (
      await page.request.get(`${apiUrl}/conversations/${id}/branches`)
    ).json()) as Array<{
      name: string;
      headMessageId: string | null;
    }>;
    const head = after.find((branch) => branch.name === "release")?.headMessageId;

    expect(head).toBeTruthy();
    expect(
      await messageRow(page, `release work ${stamp}`)
        .locator(".commit-id")
        .innerText(),
    ).toBe((head ?? "").slice(0, 8));
  } finally {
    await context.close();
  }
});

test("git revert flags the target live on both clients and after a reload", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-five-revert-${stamp}`;
  const text = `phase five revert ${stamp}`;
  const sender = await openClientContext(browser);
  let receiver: Awaited<ReturnType<typeof openClientContext>> | null = null;

  try {
    await createChannel(sender.page, channelName);
    receiver = await openClientContext(browser);
    await openChannel(receiver.page, channelName);

    await sendCommand(sender.page, `git commit -m "${text}"`);
    await expect(messageText(sender.page, text)).toBeVisible();
    await expect(messageText(receiver.page, text)).toBeVisible({
      timeout: 15_000,
    });

    const id = await messageRow(sender.page, text)
      .locator(".commit-id")
      .innerText();

    await sendCommand(sender.page, `git revert ${id}`);

    await expect(messageText(sender.page, `Revert "${text}"`)).toBeVisible();
    await expect(
      messageRow(sender.page, text).locator(".revert-pill"),
    ).toBeVisible();
    await saveScreenshot(sender.page, "revert-reverted-pill");

    // The receiver was never reloaded: this state arrived as message.updated.
    await expect(
      messageRow(receiver.page, text).locator(".revert-pill"),
    ).toBeVisible({ timeout: 15_000 });
    await saveScreenshot(receiver.page, "revert-other-client-live");

    const conversation = await conversationId(sender.page, channelName);
    const stored = (await (
      await sender.page.request.get(
        `${apiUrl}/conversations/${conversation}/messages`,
      )
    ).json()) as Array<{ id: string; reverted: boolean }>;

    expect(
      stored.find((message) => message.id.startsWith(id))?.reverted,
    ).toBe(true);

    await receiver.page.reload();
    await openChannel(receiver.page, channelName);

    await expect(
      messageRow(receiver.page, text).locator(".revert-pill"),
    ).toBeVisible({ timeout: 15_000 });
    await saveScreenshot(receiver.page, "revert-after-reload");
  } finally {
    await sender.context.close();
    await receiver?.context.close();
  }
});

test("git merge records the merge message and survives a reload", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-five-merge-${stamp}`;
  const { context, page } = await openClientContext(browser);

  try {
    await createChannel(page, channelName);

    await sendCommand(page, `git commit -m "main line ${stamp}"`);
    await expect(messageText(page, `main line ${stamp}`)).toBeVisible();

    await sendCommand(page, "git branch feature");
    await expect(branchButton(page)).toContainText("main");

    await sendCommand(page, "git switch feature");
    await expect(branchButton(page)).toContainText("feature");

    await sendCommand(page, `git commit -m "feature line ${stamp}"`);
    await expect(messageText(page, `feature line ${stamp}`)).toBeVisible();

    await sendCommand(page, "git merge main");

    const mergeText = "Merge branch 'main' into feature";

    await expect(messageText(page, mergeText)).toBeVisible();
    await saveScreenshot(page, "merge-message");

    await page.reload();
    await openChannel(page, channelName);

    await expect(messageText(page, mergeText)).toBeVisible();
    await expect(branchButton(page)).toContainText("feature");
    await saveScreenshot(page, "merge-after-reload");

    const id = await conversationId(page, channelName);
    const stored = (await (
      await page.request.get(`${apiUrl}/conversations/${id}/messages`)
    ).json()) as Array<{ text: string; command: string }>;

    expect(
      stored.some(
        (message) =>
          message.text === mergeText && message.command === "git merge",
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test("git stash hides the message on both clients until a pop restores it", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-five-stash-${stamp}`;
  const text = `phase five stash ${stamp}`;
  const sender = await openClientContext(browser);
  let receiver: Awaited<ReturnType<typeof openClientContext>> | null = null;

  try {
    await createChannel(sender.page, channelName);
    receiver = await openClientContext(browser);
    await openChannel(receiver.page, channelName);

    await sendCommand(sender.page, `git commit -m "${text}"`);
    await expect(messageText(sender.page, text)).toBeVisible();
    await expect(messageText(receiver.page, text)).toBeVisible({
      timeout: 15_000,
    });

    await sendCommand(sender.page, "git stash");

    // The message is set aside, not deleted, so it leaves the chat and the
    // notice reports the count.
    await expect(messageText(sender.page, text)).toHaveCount(0);
    await expect(sender.page.locator(".dynamic-island")).toContainText(
      "1 stashed message",
    );
    await saveScreenshot(sender.page, "stash-hidden");

    await sendCommand(sender.page, "git stash list");
    await expect(sender.page.locator(".dynamic-island")).toContainText(
      "1 stashed message",
    );
    await saveScreenshot(sender.page, "stash-list-notice");

    // The receiver was never reloaded: the stashed state arrived live.
    await expect(messageText(receiver.page, text)).toHaveCount(0, {
      timeout: 15_000,
    });
    await saveScreenshot(receiver.page, "stash-other-client-live");

    const id = await conversationId(sender.page, channelName);
    const stashes = (await (
      await sender.page.request.get(`${apiUrl}/conversations/${id}/stashes`)
    ).json()) as Array<{ id: string; text: string }>;

    expect(stashes.map((stash) => stash.text)).toEqual([text]);

    await sendCommand(sender.page, "git stash pop");

    await expect(messageText(sender.page, text)).toBeVisible();
    await expect(sender.page.locator(".dynamic-island")).toContainText(
      "Restored from stash",
    );
    await saveScreenshot(sender.page, "stash-pop-restored");

    await expect(messageText(receiver.page, text)).toBeVisible({
      timeout: 15_000,
    });

    await sender.page.reload();
    await openChannel(sender.page, channelName);

    await expect(messageText(sender.page, text)).toBeVisible();
    await saveScreenshot(sender.page, "stash-after-reload");

    const stored = (await (
      await sender.page.request.get(
        `${apiUrl}/conversations/${id}/messages`,
      )
    ).json()) as Array<{ text: string; stashed: boolean }>;

    expect(stored.find((message) => message.text === text)?.stashed).toBe(false);
  } finally {
    await sender.context.close();
    await receiver?.context.close();
  }
});
