import * as SQLite from 'expo-sqlite';
import type { DayStats, TrackPoint, Units } from '../lib/types';

/**
 * Everything is stored on the phone in one SQLite file, so the app works
 * offline on the mountain. Points are written as they arrive so a crash or a
 * killed app never loses a day.
 */

const SCHEMA_VERSION = 1;
let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (db) return db;
  db = SQLite.openDatabaseSync('ski.db');
  migrate(db);
  return db;
}

function migrate(d: SQLite.SQLiteDatabase) {
  const row = d.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
  d.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      place TEXT,
      stats_json TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS points (
      session_id TEXT NOT NULL,
      t INTEGER NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      alt REAL,
      acc REAL,
      spd REAL
    );
    CREATE INDEX IF NOT EXISTS points_session_t ON points(session_id, t);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT);

    -- Phase 2 (challenges): a stretch of piste with start/finish gates, and timed attempts on it.
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      path_json TEXT NOT NULL,
      gate_radius REAL NOT NULL DEFAULT 30,
      creator_name TEXT
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY NOT NULL,
      segment_id TEXT NOT NULL,
      session_id TEXT,
      player_name TEXT,
      time REAL NOT NULL,
      at INTEGER NOT NULL,
      ghost_json TEXT
    );
    CREATE INDEX IF NOT EXISTS attempts_segment ON attempts(segment_id, time);
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- key/value (settings + active session) ----------

export async function kvGet(key: string): Promise<string | null> {
  const row = await getDb().getFirstAsync<{ value: string | null }>('SELECT value FROM kv WHERE key = ?', key);
  return row?.value ?? null;
}

export async function kvSet(key: string, value: string | null): Promise<void> {
  if (value == null) await getDb().runAsync('DELETE FROM kv WHERE key = ?', key);
  else await getDb().runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
}

export interface Settings {
  name: string;
  units: Units;
  simulate: boolean;
}

export const DEFAULT_SETTINGS: Settings = { name: '', units: 'metric', simulate: false };

export async function loadSettings(): Promise<Settings> {
  const raw = await kvGet('settings');
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await kvSet('settings', JSON.stringify(s));
}

// ---------- sessions ----------

export interface SessionRow {
  id: string;
  startedAt: number;
  endedAt: number | null;
  place: string | null;
  stats: DayStats | null;
  isDemo: boolean;
}

interface RawSession {
  id: string;
  started_at: number;
  ended_at: number | null;
  place: string | null;
  stats_json: string | null;
  is_demo: number;
}

function toSession(r: RawSession): SessionRow {
  let stats: DayStats | null = null;
  try {
    stats = r.stats_json ? JSON.parse(r.stats_json) : null;
  } catch {
    stats = null;
  }
  return { id: r.id, startedAt: r.started_at, endedAt: r.ended_at, place: r.place, stats, isDemo: !!r.is_demo };
}

export async function createSession(startedAt: number, isDemo = false): Promise<string> {
  const id = newId();
  await getDb().runAsync(
    'INSERT INTO sessions (id, started_at, is_demo) VALUES (?, ?, ?)',
    id, startedAt, isDemo ? 1 : 0,
  );
  return id;
}

export async function finishSession(id: string, endedAt: number, stats: DayStats, place: string | null) {
  await getDb().runAsync(
    'UPDATE sessions SET ended_at = ?, stats_json = ?, place = COALESCE(?, place) WHERE id = ?',
    endedAt, JSON.stringify(stats), place, id,
  );
}

export async function renameSession(id: string, place: string) {
  await getDb().runAsync('UPDATE sessions SET place = ? WHERE id = ?', place.trim() || null, id);
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const r = await getDb().getFirstAsync<RawSession>('SELECT * FROM sessions WHERE id = ?', id);
  return r ? toSession(r) : null;
}

/** Finished days, newest first. */
export async function listSessions(): Promise<SessionRow[]> {
  const rows = await getDb().getAllAsync<RawSession>(
    'SELECT * FROM sessions WHERE ended_at IS NOT NULL ORDER BY started_at DESC',
  );
  return rows.map(toSession);
}

export async function deleteSession(id: string) {
  const d = getDb();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM points WHERE session_id = ?', id);
    await d.runAsync('DELETE FROM attempts WHERE session_id = ?', id);
    await d.runAsync('DELETE FROM sessions WHERE id = ?', id);
  });
}

export async function deleteAllData() {
  const d = getDb();
  await d.withTransactionAsync(async () => {
    for (const t of ['points', 'sessions', 'attempts', 'segments']) await d.runAsync(`DELETE FROM ${t}`);
    await d.runAsync("DELETE FROM kv WHERE key != 'settings'");
  });
}

export async function deleteDemoData() {
  const d = getDb();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM points WHERE session_id IN (SELECT id FROM sessions WHERE is_demo = 1)');
    await d.runAsync('DELETE FROM sessions WHERE is_demo = 1');
  });
}

// ---------- points ----------

export async function insertPoints(sessionId: string, pts: TrackPoint[]): Promise<void> {
  if (!pts.length) return;
  const d = getDb();
  await d.withTransactionAsync(async () => {
    const stmt = await d.prepareAsync(
      'INSERT INTO points (session_id, t, lat, lon, alt, acc, spd) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    try {
      for (const p of pts) await stmt.executeAsync(sessionId, p.t, p.lat, p.lon, p.alt, p.acc, p.spd);
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

/** Points of a session, optionally only those newer than `afterT`. */
export async function getPoints(sessionId: string, afterT = -1): Promise<TrackPoint[]> {
  return getDb().getAllAsync<TrackPoint>(
    'SELECT t, lat, lon, alt, acc, spd FROM points WHERE session_id = ? AND t > ? ORDER BY t',
    sessionId, afterT,
  );
}
