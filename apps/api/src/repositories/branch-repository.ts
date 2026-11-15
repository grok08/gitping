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

function toBranchSummary(
  row: BranchSummaryRow,
  currentBranchId: string | null,
): BranchSummary {
  return {
    id: row.id,
    name: row.name,
    headMessageId: row.head_message_id,
    current: row.id === currentBranchId,
  };
}

const selectBranch = `
  SELECT
    id,
    conversation_id,
    name,
    head_message_id,
    created_from_branch_id,
    created_at
  FROM branches
`;

/**
 * A member is always on exactly one branch of the conversation. The column can
 * be NULL for a member created before migration 3, so the read resolves that to
 * the conversation's `main` branch instead of forcing every caller to guess.
 */
const currentBranch = `
  SELECT
    b.id,
    b.conversation_id,
    b.name,
    b.head_message_id,
    b.created_from_branch_id,
    b.created_at
  FROM branches b
  WHERE b.id = COALESCE(
    (
      SELECT member.current_branch_id
      FROM conversation_members member
      WHERE member.conversation_id = $conversationId
        AND member.user_id = $userId
    ),
    (
      SELECT main.id
      FROM branches main
      WHERE main.conversation_id = $conversationId
        AND main.name = 'main'
    )
  )
`;

export function createBranchRepository(db: Database) {
  return {
    find(conversationId: string, name: string): Branch | null {
      const row = db
        .query(`${selectBranch} WHERE conversation_id = $conversationId AND name = $name`)
        .get({ $conversationId: conversationId, $name: name }) as BranchRow | null;

      return row ? toBranch(row) : null;
    },

    findById(id: string): Branch | null {
      const row = db
        .query(`${selectBranch} WHERE id = $id`)
        .get({ $id: id }) as BranchRow | null;

      return row ? toBranch(row) : null;
    },

    currentFor(conversationId: string, userId: string): Branch | null {
      const row = db
        .query(currentBranch)
        .get({ $conversationId: conversationId, $userId: userId }) as
        | BranchRow
        | null;

      return row ? toBranch(row) : null;
    },

    setCurrent(conversationId: string, userId: string, branchId: string): void {
      db.query(`
        UPDATE conversation_members
        SET current_branch_id = $branchId
        WHERE conversation_id = $conversationId AND user_id = $userId
      `).run({
        $conversationId: conversationId,
        $userId: userId,
        $branchId: branchId,
      });
    },

    list(
      conversationId: string,
      currentBranchId: string | null,
    ): BranchSummary[] {
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

      return rows.map((row) => toBranchSummary(row, currentBranchId));
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
