import type { Database } from "bun:sqlite";
import type {
  Conversation,
  ConversationKind,
  NewConversation,
} from "../types/domain";
import type {
  ConversationMemberRecord,
  ConversationSummary,
} from "../types/http";

type ConversationRow = {
  id: string;
  name: string;
  kind: ConversationKind;
  created_by: string;
  created_at: string;
};

type ConversationSummaryRow = {
  id: string;
  name: string;
  kind: ConversationKind;
  member_count: number;
  preview: string | null;
  unread_count: number;
};

type ConversationMemberRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar: string;
  role: ConversationMemberRecord["role"];
};

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    memberCount: row.member_count,
    preview: row.preview,
    unreadCount: row.unread_count,
  };
}

function toMember(row: ConversationMemberRow): ConversationMemberRecord {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatar: row.avatar,
    role: row.role,
  };
}

const conversationColumns = `
  SELECT id, name, kind, created_by, created_at
  FROM conversations
`;

const conversationSummary = `
  SELECT
    c.id,
    c.name,
    c.kind,
    (
      SELECT COUNT(*)
      FROM conversation_members member
      WHERE member.conversation_id = c.id
    ) AS member_count,
    (
      SELECT msg.text
      FROM messages msg
      WHERE msg.conversation_id = c.id
      ORDER BY msg.seq DESC
      LIMIT 1
    ) AS preview,
    (
      SELECT COUNT(*)
      FROM messages msg
      WHERE msg.conversation_id = c.id
        AND msg.created_at > COALESCE(viewer.last_read_at, '')
    ) AS unread_count
  FROM conversations c
  LEFT JOIN conversation_members viewer
    ON viewer.conversation_id = c.id
   AND viewer.user_id = $viewerId
`;

export function createConversationRepository(db: Database) {
  function findById(id: string): Conversation | null {
    const row = db
      .query(`${conversationColumns} WHERE id = $id`)
      .get({ $id: id }) as ConversationRow | null;

    return row ? toConversation(row) : null;
  }

  function findByKindAndName(
    kind: ConversationKind,
    name: string,
  ): Conversation | null {
    const row = db
      .query(`${conversationColumns} WHERE kind = $kind AND name = $name`)
      .get({ $kind: kind, $name: name }) as ConversationRow | null;

    return row ? toConversation(row) : null;
  }

  function listSummaries(viewerId: string): ConversationSummary[] {
    const rows = db
      .query(
        `${conversationSummary} ORDER BY c.created_at ASC, c.rowid ASC`,
      )
      .all({ $viewerId: viewerId }) as ConversationSummaryRow[];

    return rows.map(toSummary);
  }

  function findSummary(
    conversationId: string,
    viewerId: string,
  ): ConversationSummary | null {
    const row = db
      .query(`${conversationSummary} WHERE c.id = $conversationId`)
      .get({
        $conversationId: conversationId,
        $viewerId: viewerId,
      }) as ConversationSummaryRow | null;

    return row ? toSummary(row) : null;
  }

  function addMember(
    conversationId: string,
    userId: string,
    joinedAt: string,
  ): void {
    db.query(`
      INSERT OR IGNORE INTO conversation_members (
        conversation_id,
        user_id,
        joined_at,
        last_read_at
      )
      VALUES ($conversationId, $userId, $joinedAt, NULL)
    `).run({
      $conversationId: conversationId,
      $userId: userId,
      $joinedAt: joinedAt,
    });
  }

  function listMembers(conversationId: string): ConversationMemberRecord[] {
    const rows = db
      .query(`
        SELECT
          u.id,
          u.handle,
          u.display_name,
          u.avatar,
          u.role
        FROM conversation_members member
        JOIN users u ON u.id = member.user_id
        WHERE member.conversation_id = $conversationId
        ORDER BY member.joined_at ASC, u.handle ASC
      `)
      .all({ $conversationId: conversationId }) as ConversationMemberRow[];

    return rows.map(toMember);
  }

  return {
    findById,
    findByKindAndName,
    listSummaries,
    findSummary,
    listMembers,
    addMember,

    create(conversation: NewConversation): void {
      db.query(`
        INSERT INTO conversations (
          id,
          name,
          kind,
          created_by,
          created_at
        )
        VALUES ($id, $name, $kind, $createdBy, $createdAt)
      `).run({
        $id: conversation.id,
        $name: conversation.name,
        $kind: conversation.kind,
        $createdBy: conversation.createdBy,
        $createdAt: conversation.createdAt,
      });
    },
  };
}

export type ConversationRepository = ReturnType<
  typeof createConversationRepository
>;
