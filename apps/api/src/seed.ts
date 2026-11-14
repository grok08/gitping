import type { Database } from "bun:sqlite";

const seededAt = "2026-10-01T09:00:00.000Z";

const seededUsers = [
  {
    id: "user-grok08",
    handle: "grok08",
    displayName: "grok08",
    avatar: "G",
    role: "owner",
  },
  {
    id: "user-rahul",
    handle: "rahul",
    displayName: "rahul",
    avatar: "R",
    role: "developer",
  },
  {
    id: "user-alice",
    handle: "alice",
    displayName: "alice",
    avatar: "A",
    role: "developer",
  },
  {
    id: "user-maria",
    handle: "maria",
    displayName: "maria",
    avatar: "M",
    role: "developer",
  },
] as const;

const seededConversations = [
  { id: "conv-general", name: "general", kind: "channel" },
  { id: "conv-engineering", name: "engineering", kind: "channel" },
  { id: "conv-random", name: "random", kind: "channel" },
  { id: "conv-weekend", name: "weekend", kind: "channel" },
  { id: "conv-rahul", name: "rahul", kind: "direct" },
  { id: "conv-alice", name: "alice", kind: "direct" },
] as const;

const channelMembers = seededConversations
  .filter((conversation) => conversation.kind === "channel")
  .flatMap((conversation) =>
    seededUsers.map((user) => ({
      conversationId: conversation.id,
      userId: user.id,
    })),
  );

const directMembers = seededConversations
  .filter((conversation) => conversation.kind === "direct")
  .flatMap((conversation) => [
    { conversationId: conversation.id, userId: "user-grok08" },
    { conversationId: conversation.id, userId: `user-${conversation.name}` },
  ]);

const seededMembers = [...channelMembers, ...directMembers];

const seededBranches = seededConversations.flatMap((conversation) => {
  const mainBranch = {
    id: `branch-${conversation.id}-main`,
    conversationId: conversation.id,
    name: "main",
    createdFromBranchId: null,
  };

  if (conversation.id !== "conv-engineering") {
    return [mainBranch];
  }

  return [
    mainBranch,
    {
      id: "branch-conv-engineering-weekend",
      conversationId: conversation.id,
      name: "weekend",
      createdFromBranchId: mainBranch.id,
    },
    {
      id: "branch-conv-engineering-feature-ui",
      conversationId: conversation.id,
      name: "feature-ui",
      createdFromBranchId: mainBranch.id,
    },
  ];
});

export function seedWorkspace(db: Database): void {
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (
      id,
      handle,
      display_name,
      avatar,
      role,
      created_at
    )
    VALUES ($id, $handle, $displayName, $avatar, $role, $createdAt)
  `);

  const insertConversation = db.prepare(`
    INSERT OR IGNORE INTO conversations (
      id,
      name,
      kind,
      created_by,
      created_at
    )
    VALUES ($id, $name, $kind, $createdBy, $createdAt)
  `);

  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO conversation_members (
      conversation_id,
      user_id,
      joined_at,
      last_read_at
    )
    VALUES ($conversationId, $userId, $joinedAt, NULL)
  `);

  const insertBranch = db.prepare(`
    INSERT OR IGNORE INTO branches (
      id,
      conversation_id,
      name,
      head_message_id,
      created_from_branch_id,
      created_at
    )
    VALUES ($id, $conversationId, $name, NULL, $createdFromBranchId, $createdAt)
  `);

  for (const user of seededUsers) {
    insertUser.run({
      $id: user.id,
      $handle: user.handle,
      $displayName: user.displayName,
      $avatar: user.avatar,
      $role: user.role,
      $createdAt: seededAt,
    });
  }

  for (const conversation of seededConversations) {
    insertConversation.run({
      $id: conversation.id,
      $name: conversation.name,
      $kind: conversation.kind,
      $createdBy: "user-grok08",
      $createdAt: seededAt,
    });
  }

  for (const member of seededMembers) {
    insertMember.run({
      $conversationId: member.conversationId,
      $userId: member.userId,
      $joinedAt: seededAt,
    });
  }

  for (const branch of seededBranches) {
    insertBranch.run({
      $id: branch.id,
      $conversationId: branch.conversationId,
      $name: branch.name,
      $createdFromBranchId: branch.createdFromBranchId,
      $createdAt: seededAt,
    });
  }
}
