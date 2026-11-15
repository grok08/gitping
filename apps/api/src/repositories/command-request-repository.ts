import type { Database } from "bun:sqlite";
import type { CommandRequestRecord } from "../types/domain";

type CommandRequestRow = {
  id: string;
  conversation_id: string;
  message_id: string;
  author_id: string;
  created_at: string;
};

function toRecord(row: CommandRequestRow): CommandRequestRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    authorId: row.author_id,
    createdAt: row.created_at,
  };
}

export function createCommandRequestRepository(db: Database) {
  return {
    find(id: string): CommandRequestRecord | null {
      const row = db
        .query(`
          SELECT id, conversation_id, message_id, author_id, created_at
          FROM command_requests
          WHERE id = $id
        `)
        .get({ $id: id }) as CommandRequestRow | null;

      return row ? toRecord(row) : null;
    },

    insert(request: CommandRequestRecord): void {
      db.query(`
        INSERT INTO command_requests (
          id,
          conversation_id,
          message_id,
          author_id,
          created_at
        )
        VALUES (
          $id,
          $conversationId,
          $messageId,
          $authorId,
          $createdAt
        )
      `).run({
        $id: request.id,
        $conversationId: request.conversationId,
        $messageId: request.messageId,
        $authorId: request.authorId,
        $createdAt: request.createdAt,
      });
    },
  };
}

export type CommandRequestRepository = ReturnType<
  typeof createCommandRequestRepository
>;
