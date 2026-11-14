import type { Database } from "bun:sqlite";
import type { MessageRecord } from "../types/http";

export type MessageRow = {
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

export function createMessageRepository(db: Database) {
  return {
    list(): MessageRow[] {
      return db
        .query(`
          SELECT
            id,
            author,
            text,
            command,
            created_at
          FROM messages
          ORDER BY datetime(created_at) ASC
        `)
        .all() as MessageRow[];
    },

    insert(message: MessageRecord): void {
      db.query(`
        INSERT INTO messages (
          id,
          author,
          text,
          command,
          created_at
        )
        VALUES (
          $id,
          $author,
          $text,
          $command,
          $created_at
        )
      `).run({
        $id: message.id,
        $author: message.author,
        $text: message.text,
        $command: message.command,
        $created_at: message.createdAt,
      });
    },
  };
}

export type MessageRepository = ReturnType<typeof createMessageRepository>;
