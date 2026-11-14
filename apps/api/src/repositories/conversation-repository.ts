import type { Database } from "bun:sqlite";
import type { Conversation, ConversationKind } from "../types/domain";

type ConversationRow = {
  id: string;
  name: string;
  kind: ConversationKind;
  created_by: string;
  created_at: string;
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

export function createConversationRepository(db: Database) {
  return {
    findByKindAndName(
      kind: ConversationKind,
      name: string,
    ): Conversation | null {
      const row = db
        .query(`
          SELECT id, name, kind, created_by, created_at
          FROM conversations
          WHERE kind = $kind AND name = $name
        `)
        .get({ $kind: kind, $name: name }) as ConversationRow | null;

      return row ? toConversation(row) : null;
    },
  };
}

export type ConversationRepository = ReturnType<
  typeof createConversationRepository
>;
