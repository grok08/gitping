import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { createApp } from "./app";
import { createMessageRepository } from "./repositories/message-repository";
import { createTestDatabase } from "./test-helpers";

const createdAt = "2026-10-03T08:43:00.000Z";

async function getJson(app: Hono, path: string) {
  const response = await app.request(path);

  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function commit(app: Hono, text: string, conversationId: string) {
  const response = await app.request(
    `/conversations/${conversationId}/commands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: `git commit -m "${text}"`,
        branch: "main",
      }),
    },
  );

  expect(response.status).toBe(201);
}

function addRahulMessage(db: Database): void {
  createMessageRepository(db).insert({
    id: "message-rahul",
    conversationId: "conv-engineering",
    branchId: "branch-conv-engineering-main",
    authorId: "user-rahul",
    text: "Rahul fixed the login redirect",
    verb: "commit",
    raw: 'git commit -m "Rahul fixed the login redirect"',
    args: "{}",
    createdAt,
  });
}

function setUp(): { app: Hono; db: Database } {
  const db = createTestDatabase();

  return { app: createApp(db), db };
}

describe("GET /search", () => {
  test("returns grouped results and echoes the parsed query", async () => {
    const { app } = setUp();

    await commit(app, "Fix the login redirect", "conv-engineering");

    const { status, body } = await getJson(app, "/search?q=login");

    expect(status).toBe(200);
    expect(body.query).toEqual({
      text: "login",
      terms: ["login"],
      filters: {
        author: null,
        command: null,
        branch: null,
        after: null,
        before: null,
      },
    });

    const groups = body.groups as {
      conversations: unknown[];
      users: unknown[];
      branches: unknown[];
      messages: Array<Record<string, unknown>>;
    };

    expect(groups.messages).toHaveLength(1);
    expect(groups.messages[0]).toMatchObject({
      text: "Fix the login redirect",
      snippet: "Fix the login redirect",
      author: "grok08",
      command: "git commit",
      reverted: false,
      stashed: false,
      branch: { id: "branch-conv-engineering-main", name: "main" },
      conversation: {
        id: "conv-engineering",
        name: "engineering",
        kind: "channel",
      },
    });

    expect(body.totals).toEqual({
      conversations: 1,
      users: 0,
      branches: 0,
      messages: 1,
    });
    expect(body.truncated).toEqual({
      conversations: false,
      users: false,
      branches: false,
      messages: false,
    });
  });

  test("finds conversations, people, and branches by name", async () => {
    const { app } = setUp();

    const { body } = await getJson(app, "/search?q=eng");

    const groups = body.groups as {
      conversations: Array<{ name: string }>;
      users: unknown[];
      branches: unknown[];
    };

    expect(groups.conversations.map((hit) => hit.name)).toContain("engineering");

    const people = await getJson(app, "/search?q=rah");

    expect(
      (people.body.groups as { users: Array<{ handle: string }> }).users.map(
        (hit) => hit.handle,
      ),
    ).toEqual(["rahul"]);

    const branches = await getJson(app, "/search?q=weekend");

    expect(
      (
        branches.body.groups as {
          branches: Array<Record<string, unknown>>;
        }
      ).branches,
    ).toEqual([
      {
        id: "branch-conv-engineering-weekend",
        name: "weekend",
        conversationId: "conv-engineering",
        conversationName: "engineering",
        conversationKind: "channel",
        current: false,
      },
    ]);
  });

  test("narrows messages with a filter", async () => {
    const { app, db } = setUp();

    await commit(app, "Fix the login redirect", "conv-engineering");
    addRahulMessage(db);

    const { body } = await getJson(app, "/search?q=author:rahul");

    const groups = body.groups as {
      messages: Array<{ author: string }>;
    };

    expect(groups.messages.map((hit) => hit.author)).toEqual(["rahul"]);
  });

  test("rejects a blank query, a bad filter, a bad command, and a bad limit", async () => {
    const { app } = setUp();

    expect((await getJson(app, "/search?q=")).body).toEqual({
      error: "Search query is required",
    });
    expect((await getJson(app, "/search?q=branch:")).body).toEqual({
      error: "branch: needs a value",
    });
    expect((await getJson(app, "/search?q=after:soon")).body).toEqual({
      error: "after: expects YYYY-MM-DD or an ISO timestamp",
    });
    expect((await getJson(app, "/search?q=command:log")).body).toEqual({
      error:
        "Unknown command: log. Supported: commit, revert, merge, branch, switch, or stash.",
    });
    expect((await getJson(app, "/search?q=login&limit=0")).body).toEqual({
      error: "limit must be a whole number from 1 to 50",
    });

    expect((await getJson(app, "/search?q=branch:")).status).toBe(400);
  });

  test("caps the rows and reports the full total", async () => {
    const { app } = setUp();

    await commit(app, "deploy one", "conv-engineering");
    await commit(app, "deploy two", "conv-engineering");

    const { body } = await getJson(app, "/search?q=deploy&limit=1");
    const groups = body.groups as { messages: unknown[] };

    expect(groups.messages).toHaveLength(1);
    expect(body.totals).toMatchObject({ messages: 2 });
    expect(body.truncated).toMatchObject({ messages: true });
  });
});

describe("GET /conversations/:id/search", () => {
  test("returns the conversation's hits newest first with a total", async () => {
    const { app } = setUp();

    await commit(app, "first login note", "conv-engineering");
    await commit(app, "second login note", "conv-engineering");
    await commit(app, "login elsewhere", "conv-weekend");

    const { status, body } = await getJson(
      app,
      "/conversations/conv-engineering/search?q=login",
    );

    expect(status).toBe(200);

    const messages = body.messages as Array<{ text: string }>;

    expect(messages.map((hit) => hit.text)).toEqual([
      "second login note",
      "first login note",
    ]);
    expect(body.total).toBe(2);
    expect(body.truncated).toBe(false);
  });

  test("answers 404 for an unknown conversation", async () => {
    const { app } = setUp();

    const { status, body } = await getJson(
      app,
      "/conversations/conv-nope/search?q=login",
    );

    expect(status).toBe(404);
    expect(body).toEqual({ error: "Unknown conversation: conv-nope" });
  });
});
