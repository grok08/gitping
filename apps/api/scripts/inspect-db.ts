import { Database } from "bun:sqlite";

const path = process.argv[2];

if (!path) {
  console.error("usage: bun run db:inspect <path-to-sqlite-file>");
  process.exit(1);
}

const db = new Database(path, { readonly: true });

function print(title: string, rows: unknown) {
  console.log("");
  console.log(`## ${title}`);
  console.log(JSON.stringify(rows, null, 2));
}

const version = db.query("PRAGMA user_version").get() as {
  user_version: number;
};

const tables = db
  .query(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `)
  .all() as Array<{ name: string }>;

console.log(`database: ${path}`);
console.log(`schema version: ${version.user_version}`);
console.log("");
console.log("## row counts");

for (const table of tables) {
  const row = db.query(`SELECT COUNT(*) AS total FROM ${table.name}`).get() as {
    total: number;
  };

  console.log(`${table.name}: ${row.total}`);
}

print(
  "users",
  db
    .query("SELECT handle, display_name, role FROM users ORDER BY handle")
    .all(),
);

print(
  "conversations",
  db.query("SELECT name, kind FROM conversations ORDER BY kind, name").all(),
);

print(
  "branches",
  db
    .query(`
      SELECT
        c.name AS conversation,
        b.name AS branch,
        COALESCE(substr(b.head_message_id, 1, 8), '-') AS head
      FROM branches b
      JOIN conversations c ON c.id = b.conversation_id
      ORDER BY c.name, b.name
    `)
    .all(),
);

print(
  "messages",
  db
    .query(`
      SELECT
        m.id,
        u.handle AS author,
        c.name AS conversation,
        b.name AS branch,
        g.verb AS command,
        m.text,
        m.created_at
      FROM messages m
      JOIN users u ON u.id = m.author_id
      JOIN conversations c ON c.id = m.conversation_id
      JOIN branches b ON b.id = m.branch_id
      JOIN git_commands g ON g.message_id = m.id
      ORDER BY m.seq
    `)
    .all(),
);

print(
  "git commands",
  db.query("SELECT message_id, verb, raw, args FROM git_commands ORDER BY raw").all(),
);

print(
  "message events",
  db.query("SELECT message_id, type FROM message_events ORDER BY message_id").all(),
);
