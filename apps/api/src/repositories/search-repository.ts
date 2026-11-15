import type { Database } from "bun:sqlite";
import type { SearchCriteria } from "../search/query";
import type {
  SearchBranchHit,
  SearchConversationHit,
  SearchUserHit,
} from "../types/http";
import type { ConversationKind, UserRole } from "../types/domain";
import {
  revertedExpression,
  stashedExpression,
} from "./message-repository";

export type SearchPage<T> = {
  rows: T[];
  total: number;
};

type MessageHitRow = {
  seq: number;
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
  reverted: number;
  stashed: number;
  branch_id: string;
  branch_name: string;
  conversation_id: string;
  conversation_name: string;
  conversation_kind: ConversationKind;
  total: number;
};

type ConversationHitRow = {
  id: string;
  name: string;
  kind: ConversationKind;
  member_count: number;
  preview: string | null;
  total: number;
};

type UserHitRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar: string;
  role: UserRole;
  total: number;
};

type BranchHitRow = {
  id: string;
  name: string;
  conversation_id: string;
  conversation_name: string;
  conversation_kind: ConversationKind;
  current: number;
  total: number;
};

type Bound = Record<string, string | number | null>;

/**
 * Matches a term against one column. Kept as a function so every group agrees
 * on what matching means and the `instr` call exists once per column.
 */
function contains(column: string, parameter: string): string {
  return `instr(lower(${column}), lower(${parameter})) > 0`;
}

/** Ranks a name that the first term starts, then one it appears inside. */
function nameRank(column: string, parameter: string): string {
  return `CASE
    WHEN instr(lower(${column}), lower(${parameter})) = 1 THEN 0
    WHEN instr(lower(${column}), lower(${parameter})) > 0 THEN 1
    ELSE 2
  END`;
}

export function createSearchRepository(db: Database) {
  function conversations(
    terms: readonly string[],
    limit: number,
  ): SearchPage<SearchConversationHit> {
    if (terms.length === 0) {
      return { rows: [], total: 0 };
    }

    const first = terms[0] ?? "";
    const where = terms
      .map(
        (_term, index) =>
          `(${contains("name", `$term${index}`)} OR ${contains(
            "COALESCE(preview, '')",
            `$term${index}`,
          )})`,
      )
      .join(" AND ");
    const params: Bound = { $limit: limit, $order: first };

    terms.forEach((term, index) => {
      params[`$term${index}`] = term;
    });

    const rows = db
      .query(`
        WITH summary AS (
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
            ) AS preview
          FROM conversations c
        )
        SELECT
          id,
          name,
          kind,
          member_count,
          preview,
          COUNT(*) OVER () AS total
        FROM summary
        WHERE ${where}
        ORDER BY ${nameRank("name", "$order")}, name ASC
        LIMIT $limit
      `)
      .all(params) as ConversationHitRow[];

    return {
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        memberCount: row.member_count,
        preview: row.preview,
      })),
      total: rows[0]?.total ?? 0,
    };
  }

  function people(
    terms: readonly string[],
    limit: number,
  ): SearchPage<SearchUserHit> {
    if (terms.length === 0) {
      return { rows: [], total: 0 };
    }

    const first = terms[0] ?? "";
    const where = terms
      .map(
        (_term, index) =>
          `(${contains("handle", `$term${index}`)} OR ${contains(
            "display_name",
            `$term${index}`,
          )})`,
      )
      .join(" AND ");
    const params: Bound = { $limit: limit, $order: first };

    terms.forEach((term, index) => {
      params[`$term${index}`] = term;
    });

    const rows = db
      .query(`
        SELECT
          id,
          handle,
          display_name,
          avatar,
          role,
          COUNT(*) OVER () AS total
        FROM users
        WHERE ${where}
        ORDER BY ${nameRank("handle", "$order")}, handle ASC
        LIMIT $limit
      `)
      .all(params) as UserHitRow[];

    return {
      rows: rows.map((row) => ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        avatar: row.avatar,
        role: row.role,
      })),
      total: rows[0]?.total ?? 0,
    };
  }

  function branches(
    terms: readonly string[],
    viewerId: string,
    limit: number,
  ): SearchPage<SearchBranchHit> {
    if (terms.length === 0) {
      return { rows: [], total: 0 };
    }

    const first = terms[0] ?? "";
    const where = terms
      .map((_term, index) => contains("b.name", `$term${index}`))
      .join(" AND ");
    const params: Bound = {
      $limit: limit,
      $order: first,
      $viewerId: viewerId,
    };

    terms.forEach((term, index) => {
      params[`$term${index}`] = term;
    });

    const rows = db
      .query(`
        SELECT
          b.id,
          b.name,
          b.conversation_id,
          conv.name AS conversation_name,
          conv.kind AS conversation_kind,
          CASE WHEN b.id = COALESCE(
            (
              SELECT member.current_branch_id
              FROM conversation_members member
              WHERE member.conversation_id = conv.id
                AND member.user_id = $viewerId
            ),
            (
              SELECT main.id
              FROM branches main
              WHERE main.conversation_id = conv.id
                AND main.name = 'main'
            )
          ) THEN 1 ELSE 0 END AS current,
          COUNT(*) OVER () AS total
        FROM branches b
        JOIN conversations conv ON conv.id = b.conversation_id
        WHERE ${where}
        ORDER BY ${nameRank("b.name", "$order")}, conv.name ASC, b.name ASC
        LIMIT $limit
      `)
      .all(params) as BranchHitRow[];

    return {
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        conversationId: row.conversation_id,
        conversationName: row.conversation_name,
        conversationKind: row.conversation_kind,
        current: row.current === 1,
      })),
      total: rows[0]?.total ?? 0,
    };
  }

  /**
   * Message hits are the only group the filters narrow, and the only group
   * whose state comes from the event set rather than a column.
   */
  function messages(
    criteria: SearchCriteria,
    limit: number,
  ): SearchPage<{
    seq: number;
    id: string;
    text: string;
    author: string;
    command: string;
    createdAt: string;
    reverted: boolean;
    stashed: boolean;
    branch: { id: string; name: string };
    conversation: { id: string; name: string; kind: ConversationKind };
  }> {
    const where: string[] = [];
    const params: Bound = { $limit: limit };

    if (criteria.conversationId) {
      where.push("m.conversation_id = $conversationId");
      params.$conversationId = criteria.conversationId;
    }

    criteria.terms.forEach((term, index) => {
      where.push(contains("m.text", `$term${index}`));
      params[`$term${index}`] = term;
    });

    if (criteria.author) {
      where.push("lower(u.handle) = lower($author)");
      params.$author = criteria.author;
    }

    if (criteria.command) {
      where.push("c.verb = $command");
      params.$command = criteria.command;
    }

    if (criteria.branch) {
      where.push("b.name = $branch");
      params.$branch = criteria.branch;
    }

    if (criteria.after) {
      where.push("m.created_at >= $after");
      params.$after = criteria.after;
    }

    if (criteria.before) {
      where.push("m.created_at < $before");
      params.$before = criteria.before;
    }

    const rows = db
      .query(`
        SELECT
          m.seq,
          m.id,
          u.handle AS author,
          m.text,
          'git ' || c.verb AS command,
          m.created_at,
          (${revertedExpression}) AS reverted,
          (${stashedExpression}) AS stashed,
          b.id AS branch_id,
          b.name AS branch_name,
          conv.id AS conversation_id,
          conv.name AS conversation_name,
          conv.kind AS conversation_kind,
          COUNT(*) OVER () AS total
        FROM messages m
        JOIN users u ON u.id = m.author_id
        JOIN git_commands c ON c.message_id = m.id
        JOIN branches b ON b.id = m.branch_id
        JOIN conversations conv ON conv.id = m.conversation_id
        WHERE ${where.length > 0 ? where.join(" AND ") : "1 = 1"}
        ORDER BY m.seq DESC
        LIMIT $limit
      `)
      .all(params) as MessageHitRow[];

    return {
      rows: rows.map((row) => ({
        seq: row.seq,
        id: row.id,
        text: row.text,
        author: row.author,
        command: row.command,
        createdAt: row.created_at,
        reverted: row.reverted === 1,
        stashed: row.stashed === 1,
        branch: { id: row.branch_id, name: row.branch_name },
        conversation: {
          id: row.conversation_id,
          name: row.conversation_name,
          kind: row.conversation_kind,
        },
      })),
      total: rows[0]?.total ?? 0,
    };
  }

  return { conversations, people, branches, messages };
}

export type SearchRepository = ReturnType<typeof createSearchRepository>;
