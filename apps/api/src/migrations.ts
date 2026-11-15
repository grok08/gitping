import type { Database } from "bun:sqlite";
import { seedWorkspace } from "./seed";

type Migration = {
  version: number;
  name: string;
  run: (db: Database) => void;
};

const schemaStatements = [
  `
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('channel', 'direct')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE (kind, name)
    )
  `,
  `
    CREATE TABLE conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      last_read_at TEXT,
      PRIMARY KEY (conversation_id, user_id)
    )
  `,
  `
    CREATE TABLE branches (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      head_message_id TEXT REFERENCES messages(id),
      created_from_branch_id TEXT REFERENCES branches(id),
      created_at TEXT NOT NULL,
      UNIQUE (conversation_id, name)
    )
  `,
  `
    CREATE TABLE messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      author_id TEXT NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE git_commands (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      verb TEXT NOT NULL,
      raw TEXT NOT NULL,
      args TEXT NOT NULL,
      parsed_at TEXT NOT NULL
    )
  `,
  `
    CREATE TABLE message_events (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX idx_messages_conversation_seq
    ON messages(conversation_id, seq)
  `,
  `
    CREATE INDEX idx_messages_branch
    ON messages(branch_id)
  `,
  `
    CREATE INDEX idx_message_events_message
    ON message_events(message_id)
  `,
];

type LegacyMessageRow = {
  id: string;
  author: string;
  text: string;
  command: string;
  created_at: string;
};

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $table",
    )
    .get({ $table: table }) as { name: string } | null;

  return row !== null;
}

function columnExists(db: Database, table: string, column: string): boolean {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;

  return columns.some((entry) => entry.name === column);
}

function createDomainSchema(db: Database): void {
  for (const statement of schemaStatements) {
    db.run(statement);
  }
}

function backfillLegacyMessages(db: Database): void {
  const legacyRows = db
    .query(`
      SELECT id, author, text, command, created_at
      FROM messages_legacy
      ORDER BY datetime(created_at) ASC
    `)
    .all() as LegacyMessageRow[];

  const conversation = db
    .query(
      "SELECT id FROM conversations WHERE kind = 'channel' AND name = 'engineering'",
    )
    .get() as { id: string } | null;

  if (!conversation) {
    throw new Error("Cannot backfill legacy messages without a conversation");
  }

  const branch = db
    .query("SELECT id FROM branches WHERE conversation_id = $id AND name = 'main'")
    .get({ $id: conversation.id }) as { id: string } | null;

  if (!branch) {
    throw new Error("Cannot backfill legacy messages without a branch");
  }

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (
      id,
      handle,
      display_name,
      avatar,
      role,
      created_at
    )
    VALUES ($id, $handle, $handle, $avatar, 'developer', $createdAt)
  `);

  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (
      id,
      conversation_id,
      branch_id,
      author_id,
      text,
      created_at
    )
    VALUES ($id, $conversationId, $branchId, $authorId, $text, $createdAt)
  `);

  const insertCommand = db.prepare(`
    INSERT OR IGNORE INTO git_commands (
      id,
      message_id,
      verb,
      raw,
      args,
      parsed_at
    )
    VALUES ($id, $messageId, $verb, $raw, $args, $parsedAt)
  `);

  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO message_events (
      id,
      message_id,
      type,
      payload,
      created_at
    )
    VALUES ($id, $messageId, 'created', NULL, $createdAt)
  `);

  for (const row of legacyRows) {
    const authorId = `user-${row.author.toLowerCase()}`;

    insertUser.run({
      $id: authorId,
      $handle: row.author,
      $avatar: row.author.charAt(0).toUpperCase(),
      $createdAt: row.created_at,
    });

    insertMessage.run({
      $id: row.id,
      $conversationId: conversation.id,
      $branchId: branch.id,
      $authorId: authorId,
      $text: row.text,
      $createdAt: row.created_at,
    });

    insertCommand.run({
      $id: `legacy-command-${row.id}`,
      $messageId: row.id,
      $verb: row.command.replace(/^git\s+/i, ""),
      $raw: `${row.command} -m "${row.text}"`,
      $args: JSON.stringify({
        type: "commit",
        message: row.text,
        amend: false,
      }),
      $parsedAt: row.created_at,
    });

    insertEvent.run({
      $id: `legacy-event-${row.id}`,
      $messageId: row.id,
      $createdAt: row.created_at,
    });
  }
}

const commandRequestsSchema = `
  CREATE TABLE command_requests (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  )
`;

const migrations: Migration[] = [
  {
    version: 1,
    name: "git-native domain model",
    run(db) {
      const legacyTable =
        tableExists(db, "messages") && !columnExists(db, "messages", "conversation_id");

      if (legacyTable) {
        db.run("ALTER TABLE messages RENAME TO messages_legacy");
      }

      createDomainSchema(db);

      if (legacyTable) {
        seedWorkspace(db);
        backfillLegacyMessages(db);
        db.run("DROP TABLE messages_legacy");
      }
    },
  },
  {
    version: 2,
    name: "idempotent commands",
    run(db) {
      db.run(commandRequestsSchema);
    },
  },
];

export function schemaVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as {
    user_version: number;
  } | null;

  return row?.user_version ?? 0;
}

export function migrate(db: Database): void {
  const current = schemaVersion(db);

  for (const migration of migrations) {
    if (migration.version <= current) {
      continue;
    }

    const apply = db.transaction(() => {
      migration.run(db);
      db.run(`PRAGMA user_version = ${migration.version}`);
    });

    apply();
  }
}
