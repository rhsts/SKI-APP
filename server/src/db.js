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
  migrateAccounts(db);
  return db;
}

/**
 * Accounts (v2): a player can have a username + password, and several phones
 * ("devices") can log in as the same player. Existing players keep working:
 * each becomes a device of itself.
 */
function migrateAccounts(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(players)').all().map((c) => c.name));
  const add = (name, def) => { if (!cols.has(name)) db.exec(`ALTER TABLE players ADD COLUMN ${name} ${def}`); };
  add('username', 'TEXT');
  add('pass_hash', 'TEXT');
  add('avatar', 'TEXT');
  add('profile_json', 'TEXT');
  add('is_admin', 'INTEGER NOT NULL DEFAULT 0');
  add('last_seen', 'INTEGER');
  const hadDevices = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'devices'").get();
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS players_username ON players(username);

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY NOT NULL,
      secret_hash TEXT NOT NULL,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS devices_player ON devices(player_id);

    -- Phones of skiers an admin removed: they can't come back as a new skier.
    CREATE TABLE IF NOT EXISTS removed_devices (id TEXT PRIMARY KEY NOT NULL, removed_at INTEGER NOT NULL);

    -- Phones logged out by a password change elsewhere: told once, then they start afresh.
    CREATE TABLE IF NOT EXISTS logged_out_devices (id TEXT PRIMARY KEY NOT NULL, secret_hash TEXT NOT NULL);

    -- Online backup of whole days (GPS track included), only for accounts. The track is
    -- stored as the app sent it (gzip + base64): the server never needs to read it.
    CREATE TABLE IF NOT EXISTS tracks (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      day_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      place TEXT,
      sport TEXT,
      data TEXT NOT NULL,
      size INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, day_id)
    );
  `);
  // Once, when upgrading: every existing player becomes a device of itself.
  if (!hadDevices) {
    db.exec('INSERT OR IGNORE INTO devices (id, secret_hash, player_id, created_at) SELECT id, secret_hash, id, created_at FROM players');
  }
}
