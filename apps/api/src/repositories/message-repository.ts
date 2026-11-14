import type { Database } from "bun:sqlite";
import type { NewMessage } from "../types/domain";
import type { MessageRow } from "../types/http";

const selectMessage = `
  SELECT
    m.id,
    u.handle AS author,
    m.text,
    'git ' || c.verb AS command,
    m.created_at
  FROM messages m
  JOIN users u ON u.id = m.author_id
  JOIN git_commands c ON c.message_id = m.id
`;

export function createMessageRepository(db: Database) {
  function list(conversationId?: string): MessageRow[] {
    return db
      .query(`
        ${selectMessage}
        WHERE $conversationId IS NULL OR m.conversation_id = $conversationId
        ORDER BY m.seq ASC
      `)
      .all({ $conversationId: conversationId ?? null }) as MessageRow[];
  }

  function findById(id: string): MessageRow | null {
    return db
      .query(`${selectMessage} WHERE m.id = $id`)
      .get({ $id: id }) as MessageRow | null;
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

    db.query(`
      INSERT INTO message_events (
        id,
        message_id,
        type,
        payload,
        created_at
      )
      VALUES ($id, $messageId, 'created', NULL, $createdAt)
    `).run({
      $id: crypto.randomUUID(),
      $messageId: message.id,
      $createdAt: message.createdAt,
    });

    const record = findById(message.id);

    if (!record) {
      throw new Error(`Unable to read back message ${message.id}`);
    }

    return record;
  }

  return { list, findById, insert };
}

export type MessageRepository = ReturnType<typeof createMessageRepository>;
