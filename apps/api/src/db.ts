import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";

const dataDirectory = resolve(import.meta.dir, "../data");

mkdirSync(dataDirectory, { recursive: true });

const databasePath = resolve(dataDirectory, "gitping.db");

export const db = new Database(databasePath);

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