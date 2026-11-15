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
      schemaVersion: 3,
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
        current: true,
      },
      {
        id: "branch-conv-engineering-weekend",
        name: "weekend",
        headMessageId: null,
        current: false,
      },
      {
        id: "branch-conv-engineering-feature-ui",
        name: "feature-ui",
        headMessageId: null,
        current: false,
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

describe("idempotent command HTTP API", () => {
  const requestIdError =
    "requestId must be 8 to 64 characters of A-Z, a-z, 0-9, _ or -";

  test("returns the same message and marks the replay for one request id", async () => {
    const app = createTestApp();
    const body = JSON.stringify({
      input: 'git commit -m "lost response"',
      branch: "main",
      requestId: "request-http-1",
    });

    const first = await postConversationCommand(app, "conv-engineering", body);

    expect(first.status).toBe(201);
    expect(first.headers.get("Idempotent-Replay")).toBeNull();

    const firstBody = (await first.json()) as { message: { id: string } };

    const second = await postConversationCommand(app, "conv-engineering", body);

    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replay")).toBe("true");

    const secondBody = (await second.json()) as { message: { id: string } };

    expect(secondBody.message.id).toBe(firstBody.message.id);

    const listed = (await (await app.request("/messages")).json()) as Array<
      Record<string, unknown>
    >;

    expect(listed).toHaveLength(1);
  });

  test("accepts a request id on the compatibility command route", async () => {
    const app = createTestApp();
    const body = JSON.stringify({
      input: 'git commit -m "compat retry"',
      requestId: "request-http-2",
    });

    const first = await postCommand(app, body);
    const second = await postCommand(app, body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replay")).toBe("true");

    const firstBody = (await first.json()) as { message: { id: string } };
    const secondBody = (await second.json()) as { message: { id: string } };

    expect(secondBody.message.id).toBe(firstBody.message.id);
  });

  test("rejects a request id that is not 8 to 64 safe characters", async () => {
    const app = createTestApp();

    for (const requestId of ["short", "has spaces", "x".repeat(65), 42, ""]) {
      const response = await postConversationCommand(
        app,
        "conv-engineering",
        JSON.stringify({
          input: 'git commit -m "malformed id"',
          requestId,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: requestIdError });
    }

    const compatibility = await postCommand(
      app,
      JSON.stringify({
        input: 'git commit -m "malformed id"',
        requestId: "bad!id",
      }),
    );

    expect(compatibility.status).toBe(400);
    expect(await compatibility.json()).toEqual({ error: requestIdError });

    const listed = (await (await app.request("/messages")).json()) as unknown[];

    expect(listed).toHaveLength(0);
  });

  test("rejects a request id already used for another command with 409", async () => {
    const app = createTestApp();

    await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({
        input: 'git commit -m "engineering note"',
        requestId: "request-http-3",
      }),
    );

    const conflict = await postConversationCommand(
      app,
      "conv-weekend",
      JSON.stringify({
        input: 'git commit -m "weekend note"',
        requestId: "request-http-3",
      }),
    );

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "Request id already used for another command",
    });
  });
});

describe("branch command HTTP API", () => {
  test("answers a branch context command with the branch list", async () => {
    const app = createTestApp();

    const listed = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git branch" }),
    );

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      branches: [
        {
          id: "branch-conv-engineering-main",
          name: "main",
          headMessageId: null,
          current: true,
        },
        {
          id: "branch-conv-engineering-weekend",
          name: "weekend",
          headMessageId: null,
          current: false,
        },
        {
          id: "branch-conv-engineering-feature-ui",
          name: "feature-ui",
          headMessageId: null,
          current: false,
        },
      ],
    });

    const messages = (await (
      await app.request("/conversations/conv-engineering/messages")
    ).json()) as unknown[];

    expect(messages).toHaveLength(0);
  });

  test("creates a branch and rejects the duplicate with 409", async () => {
    const app = createTestApp();

    const created = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git branch release" }),
    );

    expect(created.status).toBe(200);

    const body = (await created.json()) as {
      branches: Array<{ name: string; current: boolean }>;
    };

    expect(body.branches.map((branch) => branch.name)).toContain("release");
    expect(body.branches.find((branch) => branch.current)?.name).toBe("main");

    const duplicate = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git branch release" }),
    );

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: "Branch already exists: release",
    });
  });

  test("switches the current branch and reports it on the branch list", async () => {
    const app = createTestApp();

    const switched = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git switch weekend" }),
    );

    expect(switched.status).toBe(200);

    const body = (await switched.json()) as {
      branches: Array<{ name: string; current: boolean }>;
    };

    expect(body.branches.find((branch) => branch.current)?.name).toBe("weekend");

    const listed = (await (
      await app.request("/conversations/conv-engineering/branches")
    ).json()) as Array<{ name: string; current: boolean }>;

    expect(listed.find((branch) => branch.current)?.name).toBe("weekend");
  });

  test("rejects an unknown branch and an invalid name with 400", async () => {
    const app = createTestApp();

    const unknown = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git switch release" }),
    );

    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown branch: release" });

    const invalid = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: 'git switch -c "has space"' }),
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Invalid branch name: has space",
    });
  });

  test("answers the compatibility route with the same union", async () => {
    const app = createTestApp();

    const response = await postCommand(
      app,
      JSON.stringify({ input: "git branch", conversation: "weekend" }),
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      branches?: Array<{ name: string; current: boolean }>;
    };

    expect(body.branches?.map((branch) => branch.name)).toEqual(["main"]);
    expect(body.branches?.[0]?.current).toBe(true);
  });

  test("keeps a rejected command at 400 with the supported set", async () => {
    const app = createTestApp();

    const response = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git log" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "Unsupported command. Use git commit, git revert, git merge, git branch, git switch, or git stash.",
    });
  });
});

describe("revert HTTP API", () => {
  test("creates a revert message and flags the target in history", async () => {
    const app = createTestApp();

    const commit = (await (
      await postConversationCommand(
        app,
        "conv-engineering",
        JSON.stringify({ input: 'git commit -m "roll this back"' }),
      )
    ).json()) as { message: { id: string; seq: number } };

    const response = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: `git revert ${commit.message.id.slice(0, 8)}` }),
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      message: {
        text: string;
        command: string;
        reverted: boolean;
        stashed: boolean;
      };
    };

    expect(body.message).toMatchObject({
      text: 'Revert "roll this back"',
      command: "git revert",
      reverted: false,
      stashed: false,
    });

    const listed = (await (
      await app.request("/conversations/conv-engineering/messages")
    ).json()) as Array<{ id: string; reverted: boolean; stashed: boolean }>;

    expect(listed.map((message) => message.reverted)).toEqual([true, false]);
    expect(listed[0]?.id).toBe(commit.message.id);
  });

  test("rejects a second revert with 409 and an unknown target with 400", async () => {
    const app = createTestApp();

    const commit = (await (
      await postConversationCommand(
        app,
        "conv-engineering",
        JSON.stringify({ input: 'git commit -m "revert me twice"' }),
      )
    ).json()) as { message: { id: string } };
    const input = `git revert ${commit.message.id.slice(0, 8)}`;

    await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input }),
    );

    const duplicate = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input }),
    );

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: `Message ${commit.message.id.slice(0, 8)} is already reverted`,
    });

    const unknown = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git revert ffff" }),
    );

    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown message: ffff" });
  });

  test("does not resolve a prefix from another conversation", async () => {
    const app = createTestApp();

    const weekend = (await (
      await postConversationCommand(
        app,
        "conv-weekend",
        JSON.stringify({ input: 'git commit -m "weekend only"' }),
      )
    ).json()) as { message: { id: string } };

    const response = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: `git revert ${weekend.message.id.slice(0, 8)}` }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: `Unknown message: ${weekend.message.id.slice(0, 8)}`,
    });
  });
});

describe("merge HTTP API", () => {
  test("answers a merge with the merge message", async () => {
    const app = createTestApp();

    await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: 'git commit -m "weekend work"', branch: "weekend" }),
    );

    const response = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git merge weekend", branch: "main" }),
    );

    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      message: { text: string; command: string };
    };

    expect(body.message).toMatchObject({
      text: "Merge branch 'weekend' into main",
      command: "git merge",
    });

    const listed = (await (
      await app.request("/conversations/conv-engineering/messages")
    ).json()) as Array<{ text: string }>;

    expect(listed.map((message) => message.text)).toEqual([
      "weekend work",
      "Merge branch 'weekend' into main",
    ]);
  });

  test("rejects a self merge and an up-to-date merge with 400", async () => {
    const app = createTestApp();

    const self = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git merge main", branch: "main" }),
    );

    expect(self.status).toBe(400);
    expect(await self.json()).toEqual({
      error: "Cannot merge a branch into itself",
    });

    const upToDate = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git merge weekend", branch: "main" }),
    );

    expect(upToDate.status).toBe(400);
    expect(await upToDate.json()).toEqual({ error: "Already up to date" });

    const unknown = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git merge release", branch: "main" }),
    );

    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown branch: release" });
  });
});

describe("stash HTTP API", () => {
  test("answers stash commands with the stash list and serves it over GET", async () => {
    const app = createTestApp();

    const commit = (await (
      await postConversationCommand(
        app,
        "conv-engineering",
        JSON.stringify({ input: 'git commit -m "set this aside"' }),
      )
    ).json()) as { message: { id: string; createdAt: string } };

    const stash = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: 'git stash push -m "later"' }),
    );

    expect(stash.status).toBe(200);
    expect(await stash.json()).toEqual({
      stashes: [
        {
          id: commit.message.id,
          text: "set this aside",
          note: "later",
          createdAt: commit.message.createdAt,
        },
      ],
    });

    const listed = (await (
      await app.request("/conversations/conv-engineering/stashes")
    ).json()) as Array<Record<string, unknown>>;

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: commit.message.id, note: "later" });

    const list = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git stash list" }),
    );

    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      stashes: [
        {
          id: commit.message.id,
          text: "set this aside",
          note: "later",
          createdAt: commit.message.createdAt,
        },
      ],
    });

    const pop = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git stash pop" }),
    );

    expect(pop.status).toBe(200);
    expect(await pop.json()).toEqual({ stashes: [] });

    const emptied = (await (
      await app.request("/conversations/conv-engineering/stashes")
    ).json()) as unknown[];

    expect(emptied).toEqual([]);

    const history = (await (
      await app.request("/conversations/conv-engineering/messages")
    ).json()) as Array<{ stashed: boolean }>;

    expect(history).toHaveLength(1);
    expect(history[0]?.stashed).toBe(false);
  });

  test("rejects stash failures with 400 and an unknown conversation with 404", async () => {
    const app = createTestApp();

    const nothing = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git stash" }),
    );

    expect(nothing.status).toBe(400);
    expect(await nothing.json()).toEqual({
      error: "Nothing to stash on main",
    });

    const emptyPop = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git stash pop" }),
    );

    expect(emptyPop.status).toBe(400);
    expect(await emptyPop.json()).toEqual({
      error: "No stash to pop on main",
    });

    const unknownPop = await postConversationCommand(
      app,
      "conv-engineering",
      JSON.stringify({ input: "git stash pop ffff" }),
    );

    expect(unknownPop.status).toBe(400);
    expect(await unknownPop.json()).toEqual({
      error: "Unknown stash: ffff",
    });

    const missing = await app.request("/conversations/conv-missing/stashes");

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Unknown conversation: conv-missing",
    });
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
