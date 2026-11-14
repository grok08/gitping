import type { Database } from "bun:sqlite";
import type { Branch } from "../types/domain";

type BranchRow = {
  id: string;
  conversation_id: string;
  name: string;
  head_message_id: string | null;
  created_from_branch_id: string | null;
  created_at: string;
};

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    name: row.name,
    headMessageId: row.head_message_id,
    createdFromBranchId: row.created_from_branch_id,
    createdAt: row.created_at,
  };
}

export function createBranchRepository(db: Database) {
  return {
    find(conversationId: string, name: string): Branch | null {
      const row = db
        .query(`
          SELECT
            id,
            conversation_id,
            name,
            head_message_id,
            created_from_branch_id,
            created_at
          FROM branches
          WHERE conversation_id = $conversationId AND name = $name
        `)
        .get({ $conversationId: conversationId, $name: name }) as BranchRow | null;

      return row ? toBranch(row) : null;
    },

    setHead(branchId: string, messageId: string): void {
      db.query(`
        UPDATE branches
        SET head_message_id = $messageId
        WHERE id = $branchId
      `).run({ $branchId: branchId, $messageId: messageId });
    },
  };
}

export type BranchRepository = ReturnType<typeof createBranchRepository>;
