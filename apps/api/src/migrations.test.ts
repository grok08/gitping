import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { initializeDatabase, openDatabase } from "./db";
import { schemaVersion } from "./migrations";
import { createMessageRepository } from "./repositories/message-repository";

function tableNames(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function count(db: Database, table: string): number {
  const row = db.query(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
    total: number;
  };

  return row.total;
}

describe("migrations", () => {
  test("creates the domain schema on a fresh database", () => {
    const db = openDatabase(":memory:");

    initializeDatabase(db);

    expect(schemaVersion(db)).toBe(2);

    const tables = tableNames(db);

    for (const table of [
      "users",
      "conversations",
      "conversation_members",
      "branches",
      "messages",
      "git_commands",
      "message_events",
    ]) {
      expect(tables).toContain(table);
    }
  });

  test("creates the command request table at version 2", () => {
    const db = openDatabase(":memory:");

    initializeDatabase(db);

    expect(schemaVersion(db)).toBe(2);
    expect(tableNames(db)).toContain("command_requests");

    const columns = db.query("PRAGMA table_info(command_requests)").all() as Array<{
      name: string;
      pk: number;
    }>;

    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "conversation_id",
      "message_id",
      "author_id",
      "created_at",
    ]);
    expect(
      columns.filter((column) => column.pk === 1).map((column) => column.name),
    ).toEqual(["id"]);
  });

  test("seeds the workspace once even when initialized twice", () => {
    const db = openDatabase(":memory:");

    initializeDatabase(db);
    initializeDatabase(db);

    expect(count(db, "users")).toBe(4);
    expect(count(db, "conversations")).toBe(6);
    expect(count(db, "conversation_members")).toBe(20);
    expect(count(db, "branches")).toBe(8);
  });

  test("upgrades a version 1 database in place", () => {
    const db = openDatabase(":memory:");

    initializeDatabase(db);

    // Rebuild the version 1 state: its schema and seed data, before
    // `command_requests` existed.
    db.run("DROP TABLE command_requests");
    db.run("PRAGMA user_version = 1");

    expect(schemaVersion(db)).toBe(1);
    expect(tableNames(db)).not.toContain("command_requests");

    initializeDatabase(db);

    expect(schemaVersion(db)).toBe(2);
    expect(tableNames(db)).toContain("command_requests");
    expect(count(db, "users")).toBe(4);
    expect(count(db, "conversations")).toBe(6);
    expect(count(db, "branches")).toBe(8);
    expect(count(db, "command_requests")).toBe(0);
  });

  test("backfills a legacy messages table into the domain model", () => {
    const db = openDatabase(":memory:");

    db.run(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        command TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    const legacyRows = [
      {
        $id: "legacy-1",
        $author: "grok08",
        $text: "first legacy message",
        $command: "git commit",
        $createdAt: "2026-01-01T10:00:00.000Z",
      },
      {
        $id: "legacy-2",
        $author: "legacyuser",
        $text: "second legacy message",
        $command: "git commit",
        $createdAt: "2026-01-02T10:00:00.000Z",
      },
    ];

    for (const row of legacyRows) {
      db.query(
        `INSERT INTO messages (id, author, text, command, created_at)
         VALUES ($id, $author, $text, $command, $createdAt)`,
      ).run(row);
    }

    initializeDatabase(db);

    expect(schemaVersion(db)).toBe(2);
    expect(tableNames(db)).not.toContain("messages_legacy");

    const messages = createMessageRepository(db).list();

    expect(messages).toEqual([
      {
        seq: 1,
        id: "legacy-1",
        author: "grok08",
        text: "first legacy message",
        command: "git commit",
        created_at: "2026-01-01T10:00:00.000Z",
      },
      {
        seq: 2,
        id: "legacy-2",
        author: "legacyuser",
        text: "second legacy message",
        command: "git commit",
        created_at: "2026-01-02T10:00:00.000Z",
      },
    ]);

    const commands = db
      .query("SELECT verb, raw, args FROM git_commands ORDER BY verb")
      .all() as Array<{ verb: string; raw: string; args: string }>;

    expect(commands).toHaveLength(2);
    expect(commands[0]?.verb).toBe("commit");
    expect(JSON.parse(commands[0]?.args ?? "{}")).toMatchObject({
      type: "commit",
      message: "first legacy message",
    });

    expect(count(db, "message_events")).toBe(2);

    const legacyUser = db
      .query("SELECT handle, display_name FROM users WHERE handle = 'legacyuser'")
      .get() as { handle: string; display_name: string };

    expect(legacyUser).toEqual({
      handle: "legacyuser",
      display_name: "legacyuser",
    });
  });

  test("does not apply a migration twice", () => {
    const db = openDatabase(":memory:");

    initializeDatabase(db);
    const conversationsAfterFirst = count(db, "conversations");

    initializeDatabase(db);

    expect(count(db, "conversations")).toBe(conversationsAfterFirst);
    expect(schemaVersion(db)).toBe(2);
  });
});
