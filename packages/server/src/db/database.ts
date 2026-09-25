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
  // Lightweight migrations: add columns older DBs predate. Each is independently
  // idempotent (fails silently once the column already exists).
  for (const stmt of [
    "ALTER TABLE branches ADD COLUMN base_tree TEXT",
    "ALTER TABLE messages ADD COLUMN reply_to_seq INTEGER",
    "ALTER TABLE messages ADD COLUMN edited_at INTEGER",
    "ALTER TABLE messages ADD COLUMN retracted_at INTEGER",
    "ALTER TABLE tasks ADD COLUMN blocked_by TEXT",
  ]) {
    try {
      db.exec(stmt);
    } catch {
      /* column already exists — fine */
    }
  }
  // approvals.delivered_at: when the requester was told the decision. On an older DB, backfill
  // it for everything already decided (only when the column is newly added) so wait_for_update
  // doesn't re-announce historical decisions.
  try {
    db.exec("ALTER TABLE approvals ADD COLUMN delivered_at INTEGER");
    db.exec("UPDATE approvals SET delivered_at = COALESCE(decided_at, created_at) WHERE status != 'pending'");
  } catch {
    /* column already exists — fine */
  }
  return db;
}
