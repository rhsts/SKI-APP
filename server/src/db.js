import { DatabaseSync } from 'node:sqlite';

/**
 * One SQLite file holds everything: players, groups, day summaries, group
 * challenges and their times. Only summaries are stored, never GPS tracks.
 */
export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY NOT NULL,
      secret_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Skier',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES players(id),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id),
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (group_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS members_player ON members(player_id);

    -- One row per recorded day per player. "date" is the skier's local date (YYYY-MM-DD).
    CREATE TABLE IF NOT EXISTS days (
      player_id TEXT NOT NULL REFERENCES players(id),
      day_id TEXT NOT NULL,
      date TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      vertical REAL NOT NULL,
      top_speed REAL NOT NULL,
      runs INTEGER NOT NULL,
      distance REAL NOT NULL,
      ski_time REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, day_id)
    );
    CREATE INDEX IF NOT EXISTS days_date ON days(date);

    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY NOT NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      segment_id TEXT NOT NULL,
      date TEXT NOT NULL,
      segment_json TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES players(id),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS challenges_group ON challenges(group_id, date);

    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY NOT NULL,
      player_id TEXT NOT NULL REFERENCES players(id),
      segment_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time REAL NOT NULL,
      at INTEGER NOT NULL,
      ghost_json TEXT
    );
    CREATE INDEX IF NOT EXISTS attempts_segment ON attempts(segment_id, date);
  `);
  return db;
}
