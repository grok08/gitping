import type { Database } from "bun:sqlite";
import type { MessageEventType, NewMessage } from "../types/domain";
import type { MessageRow, StashRecord } from "../types/http";

/**
 * SQLite has no boolean type, so the derived flags arrive as 0 or 1.
 */
type RawMessageRow = Omit<MessageRow, "reverted" | "stashed"> & {
  reverted: number;
  stashed: number;
};

function toMessageRow(row: RawMessageRow): MessageRow {
  return {
    seq: row.seq,
    id: row.id,
    author: row.author,
    text: row.text,
    command: row.command,
    created_at: row.created_at,
    reverted: row.reverted === 1,
    stashed: row.stashed === 1,
  };
}

/**
 * Message state is derived from the event set, never from a mutable column, so
 * a flag cannot drift from the events that produced it. Both expressions are
 * pure functions of the set, which makes the answer independent of the order
 * the events were written in. One definition is used for the selected column
 * and for the "not stashed" filter, so the two cannot disagree.
 */
const stashedExpression = `
  EXISTS (
    SELECT 1 FROM message_events e
    WHERE e.message_id = m.id AND e.type = 'stashed'
  ) AND NOT EXISTS (
    SELECT 1 FROM message_events e
    WHERE e.message_id = m.id AND e.type = 'unstashed'
  )
`;

const selectMessage = `
  SELECT
    m.seq,
    m.id,
    u.handle AS author,
    m.text,
    'git ' || c.verb AS command,
    m.created_at,
    EXISTS (
      SELECT 1 FROM message_events e
      WHERE e.message_id = m.id AND e.type = 'reverted'
    ) AS reverted,
    (${stashedExpression}) AS stashed
  FROM messages m
  JOIN users u ON u.id = m.author_id
  JOIN git_commands c ON c.message_id = m.id
`;

type StashRow = {
  id: string;
  text: string;
  created_at: string;
  stash_payload: string | null;
};

function noteFrom(payload: string | null): string | null {
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as { note?: unknown };

    return typeof parsed.note === "string" ? parsed.note : null;
  } catch {
    return null;
  }
}

export function createMessageRepository(db: Database) {
  function list(conversationId?: string): MessageRow[] {
    const rows = db
      .query(`
        ${selectMessage}
        WHERE $conversationId IS NULL OR m.conversation_id = $conversationId
        ORDER BY m.seq ASC
      `)
      .all({ $conversationId: conversationId ?? null }) as RawMessageRow[];

    return rows.map(toMessageRow);
  }

  function findById(id: string): MessageRow | null {
    const row = db
      .query(`${selectMessage} WHERE m.id = $id`)
      .get({ $id: id }) as RawMessageRow | null;

    return row ? toMessageRow(row) : null;
  }

  /**
   * A message is addressed by its full id or by a prefix of it, resolved
   * inside one conversation so two conversations that share an id prefix
   * cannot collide.
   */
  function findByPrefix(conversationId: string, prefix: string): MessageRow[] {
    const rows = db
      .query(`
        ${selectMessage}
        WHERE m.conversation_id = $conversationId
          AND substr(m.id, 1, length($prefix)) = $prefix
        ORDER BY m.seq ASC
      `)
      .all({
        $conversationId: conversationId,
        $prefix: prefix,
      }) as RawMessageRow[];

    return rows.map(toMessageRow);
  }

  function addEvent(event: {
    messageId: string;
    type: MessageEventType;
    payload: unknown;
    createdAt: string;
  }): void {
    db.query(`
      INSERT INTO message_events (
        id,
        message_id,
        type,
        payload,
        created_at
      )
      VALUES ($id, $messageId, $type, $payload, $createdAt)
    `).run({
      $id: crypto.randomUUID(),
      $messageId: event.messageId,
      $type: event.type,
      $payload: event.payload === null ? null : JSON.stringify(event.payload),
      $createdAt: event.createdAt,
    });
  }

  function hasEvent(messageId: string, type: MessageEventType): boolean {
    const row = db
      .query(
        `SELECT 1 AS present FROM message_events
         WHERE message_id = $messageId AND type = $type
         LIMIT 1`,
      )
      .get({ $messageId: messageId, $type: type }) as {
      present: number;
    } | null;

    return row !== null;
  }

  /**
   * The conversation's stash for one branch, newest first. A stash is only a
   * flag plus a note on a message, so the list is derived, not stored.
   */
  function listStashed(
    conversationId: string,
    branchId: string,
  ): StashRecord[] {
    const rows = db
      .query(`
        SELECT
          m.id,
          m.text,
          m.created_at,
          (
            SELECT e.payload FROM message_events e
            WHERE e.message_id = m.id AND e.type = 'stashed'
            ORDER BY e.rowid DESC
            LIMIT 1
          ) AS stash_payload
        FROM messages m
        WHERE m.conversation_id = $conversationId
          AND m.branch_id = $branchId
          AND (${stashedExpression})
        ORDER BY m.seq DESC
      `)
      .all({ $conversationId: conversationId, $branchId: branchId }) as StashRow[];

    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      note: noteFrom(row.stash_payload),
      createdAt: row.created_at,
    }));
  }

  /**
   * The newest message on the branch that is not already stashed, which is what
   * `git stash` sets aside.
   */
  function findNewestOnBranch(
    conversationId: string,
    branchId: string,
  ): MessageRow | null {
    const row = db
      .query(`
        ${selectMessage}
        WHERE m.conversation_id = $conversationId
          AND m.branch_id = $branchId
          AND NOT (${stashedExpression})
        ORDER BY m.seq DESC
        LIMIT 1
      `)
      .get({ $conversationId: conversationId, $branchId: branchId }) as
      | RawMessageRow
      | null;

    return row ? toMessageRow(row) : null;
  }

  function insert(message: NewMessage): MessageRow {
    db.query(`
      INSERT INTO messages (
        id,
        conversation_id,
        branch_id,
        author_id,
        text,
        created_at
      )
      VALUES (
        $id,
        $conversationId,
        $branchId,
        $authorId,
        $text,
        $createdAt
      )
    `).run({
      $id: message.id,
      $conversationId: message.conversationId,
      $branchId: message.branchId,
      $authorId: message.authorId,
      $text: message.text,
      $createdAt: message.createdAt,
    });

    db.query(`
      INSERT INTO git_commands (
        id,
        message_id,
        verb,
        raw,
        args,
        parsed_at
      )
      VALUES (
        $id,
        $messageId,
        $verb,
        $raw,
        $args,
        $parsedAt
      )
    `).run({
      $id: crypto.randomUUID(),
      $messageId: message.id,
      $verb: message.verb,
      $raw: message.raw,
      $args: message.args,
      $parsedAt: message.createdAt,
    });

    addEvent({
      messageId: message.id,
      type: "created",
      payload: null,
      createdAt: message.createdAt,
    });

    const record = findById(message.id);

    if (!record) {
      throw new Error(`Unable to read back message ${message.id}`);
    }

    return record;
  }

  return {
    list,
    findById,
    findByPrefix,
    findNewestOnBranch,
    listStashed,
    addEvent,
    hasEvent,
    insert,
  };
}

export type MessageRepository = ReturnType<typeof createMessageRepository>;
