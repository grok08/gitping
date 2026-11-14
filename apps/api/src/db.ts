import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.run("PRAGMA foreign_keys = ON");

  return db;
}

export function initializeSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      command TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages(created_at)
  `);
}

export function defaultDatabasePath(): string {
  const dataDirectory = resolve(import.meta.dir, "../data");

  return resolve(dataDirectory, "gitping.db");
}
