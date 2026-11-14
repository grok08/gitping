import type { Page } from "@playwright/test";

export const apiUrl = "http://localhost:3000";

const initialMessages = [
  {
    id: "playwright-seed",
    author: "rahul",
    text: "Ready to ship?",
    command: "git commit",
    created_at: "2026-10-03T08:42:00.000Z",
  },
];

export async function openApp(
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
  await page.evaluate(() => document.fonts.ready);

  return submittedCommands;
}
