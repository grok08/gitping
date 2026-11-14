import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { initializeSchema, openDatabase } from "./db";

function createTestApp() {
  const db = openDatabase(":memory:");

  initializeSchema(db);

  return createApp(db);
}

function postCommand(app: ReturnType<typeof createApp>, body: string) {
  return app.request("/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("HTTP API", () => {
  test("reports a healthy database", async () => {
    const response = await createTestApp().request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: true });
  });

  test("creates a message from a commit command", async () => {
    const app = createTestApp();

    const response = await postCommand(
      app,
      JSON.stringify({ input: 'git commit -m "shipping phase one"' }),
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      message: Record<string, unknown>;
    };

    expect(body.message).toMatchObject({
      author: "grok08",
      text: "shipping phase one",
      command: "git commit",
    });

    const listed = (await (await app.request("/messages")).json()) as Array<
      Record<string, unknown>
    >;

    expect(listed).toHaveLength(1);
    expect(listed[0]?.text).toBe("shipping phase one");
  });

  test("rejects a request without a command", async () => {
    const response = await postCommand(createTestApp(), JSON.stringify({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Command is required" });
  });

  test("rejects a body that is not JSON", async () => {
    const response = await postCommand(createTestApp(), "not json");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON request body",
    });
  });
});
