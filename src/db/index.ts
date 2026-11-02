import * as SQLite from 'expo-sqlite';
import type { PisteMatch } from '../lib/pistes';
import type { Attempt, PathPoint, Segment } from '../lib/segments';
import type { DayStats, TrackPoint, Units } from '../lib/types';

/**
 * Everything is stored on the phone in one SQLite file, so the app works
 * offline on the mountain. Points are written as they arrive so a crash or a
 * killed app never loses a day.
 */

const SCHEMA_VERSION = 4;
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
  if (version < 1) migrateV1(d);
  if (version < 2) {
    d.execSync(`
      ALTER TABLE attempts ADD COLUMN player_id TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS attempts_session ON attempts(session_id);
    `);
  }
  if (version < 3) d.execSync('ALTER TABLE points ADD COLUMN pres REAL');
  if (version < 4) d.execSync('ALTER TABLE sessions ADD COLUMN pistes_json TEXT');
  d.execSync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

function migrateV1(d: SQLite.SQLiteDatabase) {
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
  /** Random id that identifies you on shared leaderboards. */
  playerId: string;
  name: string;
  units: Units;
  simulate: boolean;
  theme: 'system' | 'light' | 'dark';
  /** Buzz on a new top speed and at the end of each run. */
  vibrate: boolean;
}

export const DEFAULT_SETTINGS: Settings = { playerId: '', name: '', units: 'metric', simulate: false, theme: 'system', vibrate: true };

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
  /** Piste name per run (keyed by run start time); null = not looked up yet. */
  pistes: Record<string, PisteMatch> | null;
}

interface RawSession {
  id: string;
  started_at: number;
  ended_at: number | null;
  place: string | null;
  stats_json: string | null;
  is_demo: number;
  pistes_json: string | null;
}

function toSession(r: RawSession): SessionRow {
  let stats: DayStats | null = null;
  try {
    stats = r.stats_json ? JSON.parse(r.stats_json) : null;
  } catch {
    stats = null;
  }
  let pistes: Record<string, PisteMatch> | null = null;
  try {
    pistes = r.pistes_json ? JSON.parse(r.pistes_json) : null;
  } catch {
    pistes = null;
  }
  return { id: r.id, startedAt: r.started_at, endedAt: r.ended_at, place: r.place, stats, isDemo: !!r.is_demo, pistes };
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

export async function setSessionPistes(id: string, pistes: Record<string, PisteMatch>) {
  await getDb().runAsync('UPDATE sessions SET pistes_json = ? WHERE id = ?', JSON.stringify(pistes), id);
}

/** Inserts a finished day with a known id (restoring a backup). Returns false if it already exists. */
export async function insertSessionRaw(s: {
  id: string; startedAt: number; endedAt: number | null; place: string | null; isDemo: boolean; stats: DayStats;
}): Promise<boolean> {
  const r = await getDb().runAsync(
    'INSERT OR IGNORE INTO sessions (id, started_at, ended_at, place, stats_json, is_demo) VALUES (?, ?, ?, ?, ?, ?)',
    s.id, s.startedAt, s.endedAt ?? s.startedAt, s.place, JSON.stringify(s.stats), s.isDemo ? 1 : 0,
  );
  return r.changes > 0;
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
    await d.runAsync('DELETE FROM attempts WHERE session_id IN (SELECT id FROM sessions WHERE is_demo = 1)');
    await d.runAsync('DELETE FROM sessions WHERE is_demo = 1');
  });
}

// ---------- points ----------

export async function insertPoints(sessionId: string, pts: TrackPoint[]): Promise<void> {
  if (!pts.length) return;
  const d = getDb();
  await d.withTransactionAsync(async () => {
    const stmt = await d.prepareAsync(
      'INSERT INTO points (session_id, t, lat, lon, alt, acc, spd, pres) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    try {
      for (const p of pts) await stmt.executeAsync(sessionId, p.t, p.lat, p.lon, p.alt, p.acc, p.spd, p.pres ?? null);
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

/** Points of a session, optionally only those newer than `afterT`. */
export async function getPoints(sessionId: string, afterT = -1): Promise<TrackPoint[]> {
  return getDb().getAllAsync<TrackPoint>(
    'SELECT t, lat, lon, alt, acc, spd, pres FROM points WHERE session_id = ? AND t > ? ORDER BY t',
    sessionId, afterT,
  );
}

// ---------- challenges ----------

interface RawSegment {
  id: string;
  name: string;
  created_at: number;
  path_json: string;
  gate_radius: number;
  creator_name: string | null;
}

function toSegment(r: RawSegment): Segment {
  let path: PathPoint[] = [];
  try {
    path = JSON.parse(r.path_json);
  } catch {
    path = [];
  }
  return { id: r.id, name: r.name, createdAt: r.created_at, path, gateRadius: r.gate_radius, creatorName: r.creator_name };
}

/** Saves a challenge. Re-importing one you already have keeps your name for it. */
export async function saveSegment(seg: Segment): Promise<void> {
  await getDb().runAsync(
    `INSERT INTO segments (id, name, created_at, path_json, gate_radius, creator_name) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    seg.id, seg.name, seg.createdAt, JSON.stringify(seg.path), seg.gateRadius, seg.creatorName,
  );
}

export async function getSegment(id: string): Promise<Segment | null> {
  const r = await getDb().getFirstAsync<RawSegment>('SELECT * FROM segments WHERE id = ?', id);
  return r ? toSegment(r) : null;
}

export async function listSegments(): Promise<Segment[]> {
  const rows = await getDb().getAllAsync<RawSegment>('SELECT * FROM segments ORDER BY created_at DESC');
  return rows.map(toSegment);
}

export async function renameSegment(id: string, name: string) {
  await getDb().runAsync('UPDATE segments SET name = ? WHERE id = ?', name, id);
}

export async function deleteSegment(id: string) {
  const d = getDb();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM attempts WHERE segment_id = ?', id);
    await d.runAsync('DELETE FROM segments WHERE id = ?', id);
  });
}

interface RawAttempt {
  id: string;
  segment_id: string;
  session_id: string | null;
  player_id: string;
  player_name: string | null;
  time: number;
  at: number;
  ghost_json: string | null;
}

function toAttempt(r: RawAttempt): Attempt {
  let ghost: number[] | null = null;
  try {
    ghost = r.ghost_json ? JSON.parse(r.ghost_json) : null;
  } catch {
    ghost = null;
  }
  return {
    id: r.id, segmentId: r.segment_id, sessionId: r.session_id, playerId: r.player_id,
    playerName: r.player_name ?? 'Skier', time: r.time, at: r.at, ghost,
  };
}

/** Inserts attempts; an attempt that already exists (same player + start) is updated. */
export async function upsertAttempts(attempts: Attempt[]): Promise<void> {
  if (!attempts.length) return;
  const d = getDb();
  await d.withTransactionAsync(async () => {
    for (const a of attempts) {
      await d.runAsync(
        `INSERT INTO attempts (id, segment_id, session_id, player_id, player_name, time, at, ghost_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET player_name = excluded.player_name, time = excluded.time,
           ghost_json = COALESCE(excluded.ghost_json, attempts.ghost_json),
           session_id = COALESCE(attempts.session_id, excluded.session_id)`,
        a.id, a.segmentId, a.sessionId, a.playerId, a.playerName, a.time, a.at, a.ghost ? JSON.stringify(a.ghost) : null,
      );
    }
  });
}

export async function listAttempts(segmentId?: string): Promise<Attempt[]> {
  const rows = segmentId
    ? await getDb().getAllAsync<RawAttempt>('SELECT * FROM attempts WHERE segment_id = ? ORDER BY at DESC', segmentId)
    : await getDb().getAllAsync<RawAttempt>('SELECT * FROM attempts ORDER BY at DESC');
  return rows.map(toAttempt);
}

export async function listSessionAttempts(sessionId: string): Promise<Attempt[]> {
  const rows = await getDb().getAllAsync<RawAttempt>('SELECT * FROM attempts WHERE session_id = ? ORDER BY at', sessionId);
  return rows.map(toAttempt);
}

export async function deleteSessionAttempts(sessionId: string, segmentId?: string) {
  if (segmentId) await getDb().runAsync('DELETE FROM attempts WHERE session_id = ? AND segment_id = ?', sessionId, segmentId);
  else await getDb().runAsync('DELETE FROM attempts WHERE session_id = ?', sessionId);
}

/** Your own name changed: update it on your attempts so shared leaderboards show the new one. */
export async function renamePlayer(playerId: string, name: string) {
  await getDb().runAsync('UPDATE attempts SET player_name = ? WHERE player_id = ?', name, playerId);
}
