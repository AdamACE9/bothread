/** SQLite DDL for the Bothread hub. Idempotent (IF NOT EXISTS). */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS rooms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  project_path TEXT,
  session_id   TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  settings     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id             TEXT PRIMARY KEY,
  room_id        TEXT NOT NULL,
  name           TEXT NOT NULL,
  brand          TEXT,
  kind           TEXT NOT NULL,
  status         TEXT NOT NULL,
  capabilities   TEXT,
  mcp_session_id TEXT,
  joined_at      INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
CREATE INDEX IF NOT EXISTS idx_part_room ON participants(room_id);
CREATE INDEX IF NOT EXISTS idx_part_mcp  ON participants(mcp_session_id);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  room_id     TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  author_id   TEXT NOT NULL,
  author_name TEXT NOT NULL,
  kind        TEXT NOT NULL,
  importance  TEXT NOT NULL,
  text        TEXT NOT NULL,
  mentions    TEXT NOT NULL DEFAULT '[]',
  thread_id   TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_room_seq ON messages(room_id, seq);

CREATE TABLE IF NOT EXISTS leases (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL,
  participant_id   TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  path_pattern     TEXT NOT NULL,
  exclusive        INTEGER NOT NULL,
  reason           TEXT,
  status           TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  released_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_lease_room_status ON leases(room_id, status);

CREATE TABLE IF NOT EXISTS approvals (
  id                 TEXT PRIMARY KEY,
  room_id            TEXT NOT NULL,
  requested_by_id    TEXT NOT NULL,
  requested_by_name  TEXT NOT NULL,
  action             TEXT NOT NULL,
  details            TEXT NOT NULL,
  files              TEXT,
  status             TEXT NOT NULL,
  decided_by         TEXT,
  edited_instruction TEXT,
  created_at         INTEGER NOT NULL,
  decided_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_appr_room_status ON approvals(room_id, status);

CREATE TABLE IF NOT EXISTS audit (
  id         TEXT PRIMARY KEY,
  room_id    TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  ts         INTEGER NOT NULL,
  actor_id   TEXT,
  actor_name TEXT,
  type       TEXT NOT NULL,
  payload    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_room_seq ON audit(room_id, seq);

CREATE TABLE IF NOT EXISTS counters (
  room_id TEXT NOT NULL,
  name    TEXT NOT NULL,
  value   INTEGER NOT NULL,
  PRIMARY KEY (room_id, name)
);

-- Per-agent git tracking: captures what each agent changed, surfaces as PR-style diffs.
CREATE TABLE IF NOT EXISTS branches (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL,
  participant_id   TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  branch_name      TEXT NOT NULL,
  base_sha         TEXT NOT NULL,
  paths            TEXT NOT NULL,     -- JSON array of claimed glob patterns
  diff             TEXT,              -- unified diff (populated when status → ready)
  commit_sha       TEXT,              -- the tracking branch commit SHA (if created)
  status           TEXT NOT NULL DEFAULT 'tracking',  -- tracking|ready|merged|discarded
  created_at       INTEGER NOT NULL,
  finalized_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_branch_room_status ON branches(room_id, status);
CREATE INDEX IF NOT EXISTS idx_branch_participant ON branches(room_id, participant_id);
`;
