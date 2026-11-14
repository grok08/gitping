import type { Database } from "bun:sqlite";
import type { Branch, NewBranch } from "../types/domain";
import type { BranchSummary } from "../types/http";

type BranchRow = {
  id: string;
  conversation_id: string;
  name: string;
  head_message_id: string | null;
  created_from_branch_id: string | null;
  created_at: string;
};

type BranchSummaryRow = {
  id: string;
  name: string;
  head_message_id: string | null;
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

function toBranchSummary(row: BranchSummaryRow): BranchSummary {
  return {
    id: row.id,
    name: row.name,
    headMessageId: row.head_message_id,
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

    list(conversationId: string): BranchSummary[] {
      const rows = db
        .query(`
          SELECT id, name, head_message_id
          FROM branches
          WHERE conversation_id = $conversationId
          ORDER BY
            CASE WHEN name = 'main' THEN 0 ELSE 1 END,
            created_at ASC,
            rowid ASC
        `)
        .all({ $conversationId: conversationId }) as BranchSummaryRow[];

      return rows.map(toBranchSummary);
    },

    create(branch: NewBranch): void {
      db.query(`
        INSERT INTO branches (
          id,
          conversation_id,
          name,
          head_message_id,
          created_from_branch_id,
          created_at
        )
        VALUES (
          $id,
          $conversationId,
          $name,
          $headMessageId,
          $createdFromBranchId,
          $createdAt
        )
      `).run({
        $id: branch.id,
        $conversationId: branch.conversationId,
        $name: branch.name,
        $headMessageId: branch.headMessageId,
        $createdFromBranchId: branch.createdFromBranchId,
        $createdAt: branch.createdAt,
      });
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
