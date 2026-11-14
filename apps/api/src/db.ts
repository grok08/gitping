import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { migrate } from "./migrations";
import { seedWorkspace } from "./seed";

export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.run("PRAGMA foreign_keys = ON");

  return db;
}

export function initializeDatabase(db: Database): void {
  migrate(db);
  seedWorkspace(db);
}

export function defaultDatabasePath(): string {
  const dataDirectory = resolve(import.meta.dir, "../data");

  return resolve(dataDirectory, "gitping.db");
}
