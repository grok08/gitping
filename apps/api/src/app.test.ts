import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { createTestApp } from "./test-helpers";

function postCommand(app: Hono, body: string) {
  return app.request("/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("HTTP API", () => {
  test("reports a healthy database and schema version", async () => {
    const response = await createTestApp().request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      database: true,
      schemaVersion: 1,
    });
  });

  test("creates a message from a commit command", async () => {
    const app = createTestApp();

    const response = await postCommand(
      app,
      JSON.stringify({ input: 'git commit -m "shipping phase two"' }),
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      message: Record<string, unknown>;
    };

    expect(body.message).toMatchObject({
      author: "grok08",
      text: "shipping phase two",
      command: "git commit",
    });

    const listed = (await (await app.request("/messages")).json()) as Array<
      Record<string, unknown>
    >;

    expect(listed).toHaveLength(1);
    expect(listed[0]?.text).toBe("shipping phase two");
  });

  test("accepts a conversation and branch for the command", async () => {
    const app = createTestApp();

    const response = await postCommand(
      app,
      JSON.stringify({
        input: 'git commit -m "weekend note"',
        conversation: "weekend",
        branch: "main",
      }),
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      message: { text: string };
    };

    expect(body.message.text).toBe("weekend note");
  });

  test("rejects a request without a command", async () => {
    const response = await postCommand(createTestApp(), JSON.stringify({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Command is required" });
  });

  test("rejects an unknown conversation", async () => {
    const response = await postCommand(
      createTestApp(),
      JSON.stringify({
        input: 'git commit -m "nowhere"',
        conversation: "missing",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown conversation: missing",
    });
  });

  test("rejects a body that is not JSON", async () => {
    const response = await postCommand(createTestApp(), "not json");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON request body",
    });
  });
});
