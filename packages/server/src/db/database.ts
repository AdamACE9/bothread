import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema";

export type DB = Database.Database;

/** Open (or create) the hub's SQLite database with WAL + sane pragmas. */
export function openDatabase(dbPath: string): DB {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  // WAL: concurrent readers + one writer; the right mode for a local hub.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  // Lightweight migration: add base_tree to branches if an older DB predates it.
  try {
    db.exec("ALTER TABLE branches ADD COLUMN base_tree TEXT");
  } catch {
    /* column already exists — fine */
  }
  return db;
}
