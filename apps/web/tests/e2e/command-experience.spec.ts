import { expect, test } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const appUrl = "http://127.0.0.1:4173";
const apiUrl = "http://localhost:3000";
const evidenceDirectory = resolve(
  import.meta.dirname,
  "../../../../evidence/phase-6/screenshots",
);

const liveBadge = '.connection-badge[data-connection="live"]';
const composerPlaceholder = 'git commit -m "message"';
const serverRejection =
  "Unsupported command. Use git commit, git revert, git merge, git branch, git switch, or git stash.";

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
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: appUrl, viewport });
  const page = await context.newPage();

  await openClient(page);

  return { context, page };
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
  // The created notice is transient and would sit over the composer in the
  // evidence screenshots.
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 6000 });
}

async function conversationId(page: Page, name: string): Promise<string> {
  const conversations = (await (
    await page.request.get(`${apiUrl}/conversations`)
  ).json()) as Array<{ id: string; name: string }>;
  const conversation = conversations.find((item) => item.name === name);

  expect(conversation).toBeDefined();

  return conversation?.id ?? "";
}

function suggestionLabels(page: Page) {
  return page.locator(".composer-suggestion-label");
}

test("suggestions complete a switch without sending", async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-six-suggest-${stamp}`;
  const { context, page } = await openClientContext(browser);

  try {
    await createChannel(page, channelName);
    await sendCommand(page, `git commit -m "base ${stamp}"`);
    await expect(
      page.getByRole("main").getByText(`base ${stamp}`, { exact: true }),
    ).toBeVisible();
    await sendCommand(page, "git branch weekend");
    await expect(page.locator(".branch-button")).toContainText("main");

    const rows = await page.locator(".message-row").count();

    await composer(page).fill("git sw");
    await expect(page.locator(".composer-suggestions")).toBeVisible();
    await expect(suggestionLabels(page)).toHaveText([
      "git switch <branch>",
    ]);
    await expect(page.locator(".composer-hint")).toContainText(
      "Commands: git switch",
    );
    await saveScreenshot(page, "suggestions-verb");

    // Enter accepts the highlight instead of sending, so the message count is
    // unchanged by this keystroke.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(composer(page)).toHaveValue("git switch ");
    await expect(suggestionLabels(page)).toHaveText([
      "git switch main",
      "git switch weekend",
    ]);
    await expect(page.locator(".message-row")).toHaveCount(rows);
    await saveScreenshot(page, "suggestions-branches");

    // ArrowDown starts at the current branch and moves to the next one.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(composer(page)).toHaveValue("git switch weekend");
    await expect(page.locator(".composer-suggestions")).toHaveCount(0);

    await page.keyboard.press("Enter");

    await expect(page.locator(".branch-button")).toContainText("weekend");
    await expect(composer(page)).toHaveValue("");
    await expect(page.locator(".message-row")).toHaveCount(rows);
    await saveScreenshot(page, "switch-through-suggestions");

    const id = await conversationId(page, channelName);
    const branches = (await (
      await page.request.get(`${apiUrl}/conversations/${id}/branches`)
    ).json()) as Array<{ name: string; current: boolean }>;

    expect(branches.find((branch) => branch.current)?.name).toBe("weekend");
  } finally {
    await context.close();
  }
});

test("a sent command is recalled with ArrowUp and restored with ArrowDown", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-six-history-${stamp}`;
  const command = `git commit -m "recall ${stamp}"`;
  const { context, page } = await openClientContext(browser);

  try {
    await createChannel(page, channelName);
    await sendCommand(page, command);
    await expect(
      page.getByRole("main").getByText(`recall ${stamp}`, { exact: true }),
    ).toBeVisible();
    await expect(composer(page)).toHaveValue("");

    await composer(page).click();
    await page.keyboard.press("ArrowUp");
    await expect(composer(page)).toHaveValue(command);
    await saveScreenshot(page, "history-recall");

    await page.keyboard.press("ArrowDown");
    await expect(composer(page)).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("the server rejection replaces the local reading inline", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-six-error-${stamp}`;
  const { context, page } = await openClientContext(browser);

  try {
    await createChannel(page, channelName);
    const rows = await page.locator(".message-row").count();

    await composer(page).fill("git log");

    // The composer knows from the catalog that the verb is parsed but not
    // enabled, before anything is sent.
    await expect(page.locator(".composer-tray .command-error")).toContainText(
      "git log is not enabled yet.",
    );
    await saveScreenshot(page, "inline-error-local");

    await page.keyboard.press("Enter");

    // The server's answer is the one that stays, because it is authoritative.
    await expect(page.locator(".composer-tray .command-error")).toContainText(
      serverRejection,
    );
    await expect(page.locator(".message-row")).toHaveCount(rows);
    await saveScreenshot(page, "inline-error-server");
  } finally {
    await context.close();
  }
});

test("command help lists every supported command", async ({ browser }) => {
  const { context, page } = await openClientContext(browser);

  try {
    await page.getByRole("button", { name: "Command help" }).click();

    const panel = page.locator(".side-panel");

    await expect(panel).toContainText("Command help");
    await expect(panel).toContainText("Git commands you can send");

    await expect(page.locator(".command-help-syntax")).toHaveText([
      'git commit -m "<message>"',
      "git revert <message-id>",
      "git merge <branch>",
      "git branch [<name>]",
      "git switch <branch>",
      "git stash [push|list|pop]",
    ]);
    await expect(page.locator(".command-help-note")).toContainText(
      "git log",
    );
    await expect(page.locator(".command-help-note")).toContainText(
      "not enabled yet",
    );
    await saveScreenshot(page, "command-help");
  } finally {
    await context.close();
  }
});

test("a complete command previews what it will do", async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const channelName = `phase-six-preview-${stamp}`;
  const { context, page } = await openClientContext(browser);

  try {
    await createChannel(page, channelName);

    await composer(page).fill(`git commit -m "preview ${stamp}"`);
    await expect(page.locator(".composer-hint")).toContainText(
      "Send a message on the current branch.",
    );
    await expect(page.locator(".composer-preview")).toHaveText(
      `Commit to #${channelName} on main`,
    );
    await saveScreenshot(page, "command-preview");

    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("main").getByText(`preview ${stamp}`, { exact: true }),
    ).toBeVisible();

    await sendCommand(page, "git branch weekend");
    await composer(page).fill("git merge weekend");
    await expect(page.locator(".composer-preview")).toHaveText(
      "Merge weekend into main",
    );
  } finally {
    await context.close();
  }
});

test("the composer fits a 390px viewport", async ({ browser }) => {
  const { context, page } = await openClientContext(browser, {
    width: 390,
    height: 844,
  });

  try {
    // The seeded channel is enough: this test is about the composer's width,
    // and at this viewport the sidebar is a drawer that starts closed.
    await composer(page).fill("git stash ");

    const popup = page.locator(".composer-suggestions");

    await expect(popup).toBeVisible();
    await expect(suggestionLabels(page)).toHaveText([
      'git stash push -m "<message>"',
      "git stash list",
      "git stash pop [<stash>]",
    ]);

    const box = await popup.boundingBox();

    expect(box).not.toBeNull();

    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }

    await expect(
      page.getByRole("button", { name: "Command help" }),
    ).toBeVisible();
    await saveScreenshot(page, "composer-390");
  } finally {
    await context.close();
  }
});
