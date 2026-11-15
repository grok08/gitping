import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { createTestApp, createTestDatabase } from "./test-helpers";

function postCommand(app: Hono, body: string) {
  return app.request("/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function postConversation(app: Hono, body: string) {
  return app.request("/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function postConversationCommand(app: Hono, id: string, body: string) {
  return app.request(`/conversations/${id}/commands`, {
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

describe("conversation HTTP API", () => {
  test("lists conversations with server-computed member counts, previews, and unread counts", async () => {
    const app = createTestApp();

    const response = await app.request("/conversations");

    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(body).toHaveLength(6);
    expect(body[1]).toEqual({
      id: "conv-engineering",
      name: "engineering",
      kind: "channel",
      memberCount: 4,
      preview: null,
      unreadCount: 0,
    });
  });

  test("creates a conversation, its membership, and its main branch", async () => {
    const db = createTestDatabase();
    const app = createTestApp(db);

    const response = await postConversation(
      app,
      JSON.stringify({ name: "architecture", kind: "channel" }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      conversation: {
        id: "conv-channel-architecture",
        name: "architecture",
        kind: "channel",
        memberCount: 1,
        preview: null,
        unreadCount: 0,
      },
    });

    const members = db
      .query(
        `SELECT user_id FROM conversation_members
         WHERE conversation_id = 'conv-channel-architecture'`,
      )
      .all() as Array<{ user_id: string }>;

    expect(members).toEqual([{ user_id: "user-grok08" }]);

    const branches = db
      .query(
        `SELECT id, name FROM branches
         WHERE conversation_id = 'conv-channel-architecture'`,
      )
      .all() as Array<{ id: string; name: string }>;

    expect(branches).toEqual([
      { id: "branch-conv-channel-architecture-main", name: "main" },
    ]);

    const listed = (await (await app.request("/conversations")).json()) as Array<
      Record<string, unknown>
    >;

    expect(listed.map((conversation) => conversation.id)).toContain(
      "conv-channel-architecture",
    );
  });

  test("rejects duplicate and invalid conversations with a clear error", async () => {
    const app = createTestApp();

    const duplicate = await postConversation(
      app,
      JSON.stringify({ name: "general", kind: "channel" }),
    );

    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({
      error: "A channel named general already exists",
    });

    const invalidKind = await postConversation(
      app,
      JSON.stringify({ name: "general", kind: "workspace" }),
    );

    expect(invalidKind.status).toBe(400);
    expect(await invalidKind.json()).toEqual({
      error: 'Conversation kind must be "channel" or "direct"',
    });

    const emptyName = await postConversation(
      app,
      JSON.stringify({ name: "  ", kind: "channel" }),
    );

    expect(emptyName.status).toBe(400);
    expect(await emptyName.json()).toEqual({
      error: "Conversation name is required",
    });
  });

  test("rejects a conversation body that is not JSON", async () => {
    const response = await postConversation(createTestApp(), "not json");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid JSON request body",
    });
  });

  test("returns a conversation's messages in commit order", async () => {
    const db = createTestDatabase();
    const app = createTestApp(db);

    await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: 'git commit -m "first"' }),
    );
    await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: 'git commit -m "second"' }),
    );
    await postConversationCommand(
      app,
      "conv-weekend",
      JSON.stringify({ input: 'git commit -m "elsewhere"' }),
    );

    const response = await app.request("/conversations/conv-engineering/messages");

    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<{ text: string }>;

    expect(body.map((message) => message.text)).toEqual(["first", "second"]);
  });

  test("commits into the requested conversation and branch", async () => {
    const db = createTestDatabase();
    const app = createTestApp(db);

    const response = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({
        input: 'git commit -m "ship it"',
        branch: "weekend",
      }),
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      message: { id: string; text: string; command: string };
    };

    expect(body.message).toMatchObject({
      author: "grok08",
      text: "ship it",
      command: "git commit",
    });

    const branch = db
      .query(
        `SELECT head_message_id FROM branches
         WHERE id = 'branch-conv-engineering-weekend'`,
      )
      .get() as { head_message_id: string };

    expect(branch.head_message_id).toBe(body.message.id);
  });

  test("reports an unknown branch as 400 and an unknown conversation as 404", async () => {
    const app = createTestApp();

    const branch = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: 'git commit -m "nowhere"', branch: "release" }),
    );

    expect(branch.status).toBe(400);
    expect(await branch.json()).toEqual({
      error: "Unknown branch: release",
    });

    const conversation = await postConversationCommand(
      app,
      "conv-missing",
      JSON.stringify({ input: 'git commit -m "nowhere"' }),
    );

    expect(conversation.status).toBe(404);
    expect(await conversation.json()).toEqual({
      error: "Unknown conversation: conv-missing",
    });
  });

  test("rejects a conversation command without input", async () => {
    const response = await postConversationCommand(
      createTestApp(),
      "conv-engineering",
      JSON.stringify({}),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Command is required" });
  });

  test("returns members with their user fields", async () => {
    const app = createTestApp();

    const response = await app.request("/conversations/conv-engineering/members");

    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(body).toHaveLength(4);
    expect(body.find((member) => member.handle === "grok08")).toEqual({
      id: "user-grok08",
      handle: "grok08",
      displayName: "grok08",
      avatar: "G",
      role: "owner",
    });
  });

  test("returns branches with main first", async () => {
    const app = createTestApp();

    const response = await app.request(
      "/conversations/conv-engineering/branches",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "branch-conv-engineering-main",
        name: "main",
        headMessageId: null,
      },
      {
        id: "branch-conv-engineering-weekend",
        name: "weekend",
        headMessageId: null,
      },
      {
        id: "branch-conv-engineering-feature-ui",
        name: "feature-ui",
        headMessageId: null,
      },
    ]);
  });

  test("returns 404 with an error for unknown conversation ids", async () => {
    const app = createTestApp();

    for (const path of [
      "/conversations/conv-missing/messages",
      "/conversations/conv-missing/members",
      "/conversations/conv-missing/branches",
    ]) {
      const response = await app.request(path);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Unknown conversation: conv-missing",
      });
    }
  });
});

describe("realtime upgrade guard", () => {
  test("rejects an upgrade from an origin the HTTP CORS policy also rejects", async () => {
    const response = await createTestApp().request(
      "/conversations/conv-engineering/events",
      { headers: { origin: "http://evil.example" } },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Origin not allowed" });
  });

  test("lets an allowed or missing origin through to the conversation check", async () => {
    const app = createTestApp();

    for (const headers of [
      { origin: "http://127.0.0.1:4173" },
      {},
    ] as Array<Record<string, string>>) {
      const response = await app.request(
        "/conversations/conv-missing/events",
        { headers },
      );

      expect(response.status).toBe(404);
    }
  });
});
