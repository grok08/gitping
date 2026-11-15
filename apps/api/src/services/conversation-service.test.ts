import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import {
  createTestCommandService,
  createTestConversationService,
  sentMessage,
} from "../test-helpers";

function countRows(
  db: Database,
  sql: string,
  params: Record<string, string>,
): number {
  const row = db.query(sql).get(params) as { total: number };

  return row.total;
}

describe("conversation service", () => {
  test("lists the seeded conversations with server-computed counts", () => {
    const { conversations } = createTestConversationService();

    expect(
      conversations.list("grok08").map((conversation) => ({
        id: conversation.id,
        kind: conversation.kind,
        memberCount: conversation.memberCount,
        preview: conversation.preview,
        unreadCount: conversation.unreadCount,
      })),
    ).toEqual([
      {
        id: "conv-general",
        kind: "channel",
        memberCount: 4,
        preview: null,
        unreadCount: 0,
      },
      {
        id: "conv-engineering",
        kind: "channel",
        memberCount: 4,
        preview: null,
        unreadCount: 0,
      },
      {
        id: "conv-random",
        kind: "channel",
        memberCount: 4,
        preview: null,
        unreadCount: 0,
      },
      {
        id: "conv-weekend",
        kind: "channel",
        memberCount: 4,
        preview: null,
        unreadCount: 0,
      },
      {
        id: "conv-rahul",
        kind: "direct",
        memberCount: 2,
        preview: null,
        unreadCount: 0,
      },
      {
        id: "conv-alice",
        kind: "direct",
        memberCount: 2,
        preview: null,
        unreadCount: 0,
      },
    ]);
  });

  test("computes the preview from the newest message and the unread count for the viewer", () => {
    const { db, conversations } = createTestConversationService();
    const { commands } = createTestCommandService(db);

    commands.send('git commit -m "first note"', "rahul");
    commands.send('git commit -m "second note"', "grok08");

    const engineering = conversations
      .list("grok08")
      .find((conversation) => conversation.id === "conv-engineering");

    expect(engineering?.preview).toBe("second note");
    expect(engineering?.unreadCount).toBe(2);

    const alice = conversations
      .list("alice")
      .find((conversation) => conversation.id === "conv-engineering");

    expect(alice?.unreadCount).toBe(2);
  });

  test("creates a channel with a membership and a main branch", () => {
    const { db, conversations } = createTestConversationService();

    const result = conversations.create(
      { name: "architecture", kind: "channel" },
      "grok08",
    );

    expect(result).toEqual({
      ok: true,
      value: {
        id: "conv-channel-architecture",
        name: "architecture",
        kind: "channel",
        memberCount: 1,
        preview: null,
        unreadCount: 0,
      },
    });

    expect(
      countRows(
        db,
        `SELECT COUNT(*) AS total
         FROM conversation_members
         WHERE conversation_id = $conversationId AND user_id = $userId`,
        {
          $conversationId: "conv-channel-architecture",
          $userId: "user-grok08",
        },
      ),
    ).toBe(1);

    const branch = db
      .query(`
        SELECT id, name, head_message_id
        FROM branches
        WHERE conversation_id = $conversationId
      `)
      .get({ $conversationId: "conv-channel-architecture" }) as {
      id: string;
      name: string;
      head_message_id: string | null;
    };

    expect(branch).toEqual({
      id: "branch-conv-channel-architecture-main",
      name: "main",
      head_message_id: null,
    });
  });

  test("adds the named developer to a new direct conversation when they exist", () => {
    const { db, conversations } = createTestConversationService();

    const result = conversations.create(
      { name: "maria", kind: "direct" },
      "grok08",
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: "conv-direct-maria",
        kind: "direct",
        memberCount: 2,
      },
    });

    const members = conversations.members("conv-direct-maria");

    expect(members).toMatchObject({
      ok: true,
      value: [
        { handle: "grok08" },
        { handle: "maria" },
      ],
    });

    expect(
      countRows(
        db,
        `SELECT COUNT(*) AS total FROM branches
         WHERE conversation_id = $conversationId`,
        { $conversationId: "conv-direct-maria" },
      ),
    ).toBe(1);
  });

  test("rejects a duplicate name in the same kind but allows it in the other kind", () => {
    const { conversations } = createTestConversationService();

    expect(
      conversations.create({ name: "general", kind: "channel" }, "grok08"),
    ).toEqual({
      ok: false,
      reason: "duplicate",
      error: "A channel named general already exists",
    });

    expect(
      conversations.create({ name: "general", kind: "direct" }, "grok08").ok,
    ).toBe(true);

    expect(
      conversations.create({ name: "a b", kind: "channel" }, "grok08").ok,
    ).toBe(true);
    expect(
      conversations.create({ name: "a-b", kind: "channel" }, "grok08"),
    ).toEqual({
      ok: false,
      reason: "duplicate",
      error: "A channel named a b already exists",
    });
  });

  test("trims the name before storing and checking for duplicates", () => {
    const { conversations } = createTestConversationService();

    const created = conversations.create(
      { name: "  release-train  ", kind: "channel" },
      "grok08",
    );

    expect(created).toMatchObject({
      ok: true,
      value: { name: "release-train", id: "conv-channel-release-train" },
    });

    expect(
      conversations.create(
        { name: "release-train ", kind: "channel" },
        "grok08",
      ),
    ).toMatchObject({ ok: false, reason: "duplicate" });
  });

  test("rejects invalid names and kinds before writing anything", () => {
    const { conversations } = createTestConversationService();

    expect(
      conversations.create({ name: "engineering", kind: "group" }, "grok08"),
    ).toEqual({
      ok: false,
      reason: "invalid",
      error: 'Conversation kind must be "channel" or "direct"',
    });

    expect(
      conversations.create({ name: "   ", kind: "channel" }, "grok08"),
    ).toEqual({
      ok: false,
      reason: "invalid",
      error: "Conversation name is required",
    });

    expect(
      conversations.create({ name: "!!!", kind: "channel" }, "grok08"),
    ).toEqual({
      ok: false,
      reason: "invalid",
      error: "Conversation name must include at least one letter or number",
    });

    expect(
      conversations.create(
        { name: "a".repeat(81), kind: "channel" },
        "grok08",
      ),
    ).toEqual({
      ok: false,
      reason: "invalid",
      error: "Conversation name must be 80 characters or fewer",
    });
  });

  test("returns messages ordered by commit seq and rejects unknown conversations", () => {
    const { db, conversations } = createTestConversationService();
    const { commands } = createTestCommandService(db);

    commands.send('git commit -m "first"', "grok08");
    commands.send('git commit -m "second"', "rahul");

    const result = conversations.messages("conv-engineering");

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("expected messages");
    }

    expect(result.value.map((message) => message.text)).toEqual([
      "first",
      "second",
    ]);

    expect(conversations.messages("conv-missing")).toEqual({
      ok: false,
      reason: "not_found",
      error: "Unknown conversation: conv-missing",
    });
  });

  test("returns members with their user fields", () => {
    const { conversations } = createTestConversationService();

    const result = conversations.members("conv-engineering");

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("expected members");
    }

    expect(result.value).toHaveLength(4);
    expect(
      result.value.find((member) => member.handle === "grok08"),
    ).toEqual({
      id: "user-grok08",
      handle: "grok08",
      displayName: "grok08",
      avatar: "G",
      role: "owner",
    });

    expect(conversations.members("conv-missing")).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  test("returns branches with main first and the current head", () => {
    const { db, conversations } = createTestConversationService();
    const { commands } = createTestCommandService(db);

    const before = conversations.branches("conv-engineering", "grok08");

    expect(before).toEqual({
      ok: true,
      value: [
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

    const message = sentMessage(
      commands.send('git commit -m "head moves"', "grok08", {
        conversationId: "conv-engineering",
        branch: "main",
      }),
    );

    const after = conversations.branches("conv-engineering", "grok08");

    expect(after.ok).toBe(true);

    if (!after.ok) {
      throw new Error("expected branches");
    }

    expect(after.value).toHaveLength(3);
    expect(after.value.find((branch) => branch.name === "main")).toEqual({
      id: "branch-conv-engineering-main",
      name: "main",
      headMessageId: message.id,
      current: true,
    });

    expect(conversations.branches("conv-missing", "grok08")).toEqual({
      ok: false,
      reason: "not_found",
      error: "Unknown conversation: conv-missing",
    });
  });

  test("marks the persisted current branch for the viewer, not for everyone", () => {
    const { db, conversations } = createTestConversationService();
    const { commands } = createTestCommandService(db);

    commands.send("git switch weekend", "grok08", {
      conversationId: "conv-engineering",
    });

    const grok = conversations.branches("conv-engineering", "grok08");
    const rahul = conversations.branches("conv-engineering", "rahul");

    if (!grok.ok || !rahul.ok) {
      throw new Error("expected branch lists");
    }

    expect(grok.value.find((branch) => branch.current)?.name).toBe("weekend");
    expect(rahul.value.find((branch) => branch.current)?.name).toBe("main");
  });

  test("returns the stash of the viewer's current branch", () => {
    const { db, conversations } = createTestConversationService();
    const { commands } = createTestCommandService(db);

    sentMessage(
      commands.send('git commit -m "main work"', "grok08", {
        conversationId: "conv-engineering",
        branch: "main",
      }),
    );
    sentMessage(
      commands.send('git commit -m "weekend work"', "rahul", {
        conversationId: "conv-engineering",
        branch: "weekend",
      }),
    );

    commands.send("git stash", "grok08", {
      conversationId: "conv-engineering",
      branch: "weekend",
    });

    expect(conversations.stashes("conv-engineering", "grok08")).toEqual({
      ok: true,
      value: [],
    });

    commands.send("git switch weekend", "grok08", {
      conversationId: "conv-engineering",
    });

    expect(conversations.stashes("conv-engineering", "grok08")).toMatchObject({
      ok: true,
      value: [{ text: "weekend work", note: null }],
    });

    expect(conversations.stashes("conv-engineering", "rahul")).toMatchObject({
      ok: true,
      value: [],
    });

    expect(conversations.stashes("conv-missing", "grok08")).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });
});
