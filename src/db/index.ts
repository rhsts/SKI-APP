import * as SQLite from 'expo-sqlite';
import { DEFAULT_GOALS, type Goals } from '../lib/goals';
import { isSport, type Sport } from '../lib/sport';
import type { MotionEvent, MotionKind, MotionSummary } from '../lib/motion';
import type { PisteMatch } from '../lib/pistes';
import type { TrailMap } from '../lib/trailmap';
import type { Attempt, PathPoint, Segment } from '../lib/segments';
import { statsForSport } from '../lib/stats';
import type { DayStats, TrackPoint, Units } from '../lib/types';

/**
 * Everything is stored on the phone in one SQLite file, so the app works
 * offline on the mountain. Points are written as they arrive so a crash or a
 * killed app never loses a day.
 */

const SCHEMA_VERSION = 8;
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
  if (version < 5) d.execSync("ALTER TABLE sessions ADD COLUMN sport TEXT NOT NULL DEFAULT 'ski'");
  if (version < 6) {
    d.execSync(`CREATE TABLE IF NOT EXISTS trail_maps (
      id TEXT PRIMARY KEY NOT NULL,
      fetched_at INTEGER NOT NULL,
      json TEXT NOT NULL
    )`);
  }
  if (version < 7) {
    d.execSync(`CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      uri TEXT NOT NULL,
      t INTEGER NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS photos_session ON photos(session_id, t);`);
  }
  if (version < 8) {
    d.execSync(`CREATE TABLE IF NOT EXISTS motion_events (
      session_id TEXT NOT NULL,
      t INTEGER NOT NULL,
      kind TEXT NOT NULL,
      value REAL NOT NULL,
      lat REAL,
      lon REAL,
      PRIMARY KEY (session_id, t, kind)
    )`);
  }
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
  goals: Goals;
  /** Sport picked for the next day you record. */
  sport: Sport;
  /** Notify me when I arrive at a ski area I've skied before. */
  remindStart: boolean;
  /** Use the motion sensor for jumps and falls while recording. */
  motion: boolean;
  /** After a fall, ask "Are you OK?" and open the SOS screen if there's no answer. */
  fallCheck: boolean;
  /** Friends server (your Raspberry Pi), e.g. https://ski.example.com. Empty = friends features off. */
  serverUrl: string;
  /** The app has been unlocked with a working friends server + password (the app is private). */
  unlocked: boolean;
  /** The friends server's password (SERVER_PASSWORD on the server); empty if it has none. */
  serverPassword: string;
  /** This phone's id on the friends server (the first player id it had; stays the same after logging in). */
  deviceId: string;
  /** Random secret that proves to the friends server that this phone is `deviceId`. */
  deviceSecret: string;
  /** Your account on the friends server, once created or logged in. */
  account: { username: string; isAdmin: boolean } | null;
  /** Back up your days (with GPS tracks) to your account. */
  backupDays: boolean;
  /** Development only: the lock screen was skipped (Expo Go without a server). */
  devSkip: boolean;
  /** Also share demo/simulated days with your groups (for trying it out). */
  shareDemoDays: boolean;
}

export const DEFAULT_SETTINGS: Settings = { playerId: '', name: '', units: 'metric', simulate: false, theme: 'system', vibrate: true, goals: DEFAULT_GOALS, sport: 'ski', remindStart: false, motion: true, fallCheck: true, serverUrl: '', serverPassword: '', unlocked: false, deviceId: '', deviceSecret: '', account: null, backupDays: true, devSkip: false, shareDemoDays: false };

export async function loadSettings(): Promise<Settings> {
  const raw = await kvGet('settings');
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...saved, goals: { ...DEFAULT_GOALS, ...(saved.goals ?? {}) } };
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
  sport: Sport;
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
  sport: string | null;
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
  const sport = isSport(r.sport) ? r.sport : 'ski';
  return {
    id: r.id, startedAt: r.started_at, endedAt: r.ended_at, place: r.place,
    stats: stats ? statsForSport(stats, sport) : null, isDemo: !!r.is_demo, pistes, sport,
  };
}

export async function createSession(startedAt: number, isDemo = false, sport: Sport = 'ski'): Promise<string> {
  const id = newId();
  await getDb().runAsync(
    'INSERT INTO sessions (id, started_at, is_demo, sport) VALUES (?, ?, ?, ?)',
    id, startedAt, isDemo ? 1 : 0, sport,
  );
  return id;
}

export async function setSessionSport(id: string, sport: Sport) {
  await getDb().runAsync('UPDATE sessions SET sport = ? WHERE id = ?', sport, id);
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
  id: string; startedAt: number; endedAt: number | null; place: string | null; isDemo: boolean; stats: DayStats; sport?: Sport;
}): Promise<boolean> {
  const r = await getDb().runAsync(
    'INSERT OR IGNORE INTO sessions (id, started_at, ended_at, place, stats_json, is_demo, sport) VALUES (?, ?, ?, ?, ?, ?, ?)',
    s.id, s.startedAt, s.endedAt ?? s.startedAt, s.place, JSON.stringify(s.stats), s.isDemo ? 1 : 0, s.sport ?? 'ski',
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
    await d.runAsync('DELETE FROM photos WHERE session_id = ?', id);
    await d.runAsync('DELETE FROM motion_events WHERE session_id = ?', id);
    await d.runAsync('DELETE FROM sessions WHERE id = ?', id);
  });
}

export async function deleteAllData() {
  const d = getDb();
  await d.withTransactionAsync(async () => {
    for (const t of ['points', 'sessions', 'attempts', 'segments', 'photos', 'motion_events']) await d.runAsync(`DELETE FROM ${t}`);
    await d.runAsync("DELETE FROM kv WHERE key != 'settings'");
  });
}

export async function deleteDemoData() {
  const d = getDb();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM points WHERE session_id IN (SELECT id FROM sessions WHERE is_demo = 1)');
    await d.runAsync('DELETE FROM attempts WHERE session_id IN (SELECT id FROM sessions WHERE is_demo = 1)');
    await d.runAsync('DELETE FROM motion_events WHERE session_id IN (SELECT id FROM sessions WHERE is_demo = 1)');
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

// ---------- offline trail maps ----------

export async function saveTrailMap(map: TrailMap): Promise<void> {
  await getDb().runAsync('INSERT OR REPLACE INTO trail_maps (id, fetched_at, json) VALUES (?, ?, ?)', map.id, map.fetchedAt, JSON.stringify(map));
}

export async function listTrailMaps(): Promise<TrailMap[]> {
  const rows = await getDb().getAllAsync<{ json: string }>('SELECT json FROM trail_maps ORDER BY fetched_at DESC');
  const out: TrailMap[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.json));
    } catch {
      // Skip a damaged entry.
    }
  }
  return out;
}

export async function deleteTrailMaps(): Promise<void> {
  await getDb().runAsync('DELETE FROM trail_maps');
}

// ---------- photos ----------

export interface PhotoRow {
  id: string;
  sessionId: string;
  uri: string;
  t: number;
  lat: number;
  lon: number;
}

export async function insertPhoto(p: PhotoRow): Promise<void> {
  await getDb().runAsync(
    'INSERT OR REPLACE INTO photos (id, session_id, uri, t, lat, lon) VALUES (?, ?, ?, ?, ?, ?)',
    p.id, p.sessionId, p.uri, p.t, p.lat, p.lon,
  );
}

export async function listPhotos(sessionId: string): Promise<PhotoRow[]> {
  return getDb().getAllAsync<PhotoRow>(
    'SELECT id, session_id AS sessionId, uri, t, lat, lon FROM photos WHERE session_id = ? ORDER BY t', sessionId,
  );
}

export async function deletePhoto(id: string): Promise<void> {
  await getDb().runAsync('DELETE FROM photos WHERE id = ?', id);
}

/** Where each day started (its first GPS fix), for working out the ski areas you visit. */
export async function sessionStarts(): Promise<{ id: string; place: string | null; isDemo: number; lat: number; lon: number }[]> {
  return getDb().getAllAsync(
    `SELECT s.id, s.place, s.is_demo AS isDemo, p.lat, p.lon FROM sessions s
     JOIN points p ON p.session_id = s.id
     AND p.t = (SELECT MIN(t) FROM points WHERE session_id = s.id)
     WHERE s.ended_at IS NOT NULL`,
  );
}

// ---------- jumps and falls ----------

export interface MotionRow extends MotionEvent {
  lat: number | null;
  lon: number | null;
}

export async function insertMotionEvents(sessionId: string, events: MotionRow[]): Promise<void> {
  if (!events.length) return;
  const d = getDb();
  await d.withTransactionAsync(async () => {
    for (const e of events) {
      await d.runAsync(
        'INSERT OR REPLACE INTO motion_events (session_id, t, kind, value, lat, lon) VALUES (?, ?, ?, ?, ?, ?)',
        sessionId, e.t, e.kind, e.value, e.lat, e.lon,
      );
    }
  });
}

export async function listMotionEvents(sessionId: string): Promise<MotionRow[]> {
  const rows = await getDb().getAllAsync<{ t: number; kind: string; value: number; lat: number | null; lon: number | null }>(
    'SELECT t, kind, value, lat, lon FROM motion_events WHERE session_id = ? ORDER BY t', sessionId,
  );
  return rows.filter((r) => r.kind === 'jump' || r.kind === 'fall').map((r) => ({ ...r, kind: r.kind as MotionKind }));
}

/** Jumps and falls per day, for season totals, badges and weekly challenges. */
export async function motionSummaries(): Promise<Record<string, MotionSummary>> {
  const rows = await getDb().getAllAsync<{ id: string; kind: string; n: number; best: number; total: number }>(
    'SELECT session_id AS id, kind, COUNT(*) AS n, MAX(value) AS best, SUM(value) AS total FROM motion_events GROUP BY session_id, kind',
  );
  const out: Record<string, MotionSummary> = {};
  for (const r of rows) {
    const m = (out[r.id] ??= { jumps: 0, bestAir: 0, totalAir: 0, falls: 0 });
    if (r.kind === 'jump') {
      m.jumps = r.n;
      m.bestAir = r.best;
      m.totalAir = r.total;
    } else if (r.kind === 'fall') {
      m.falls = r.n;
    }
  }
  return out;
}

export async function deleteMotionEvent(sessionId: string, t: number, kind: MotionKind): Promise<void> {
  await getDb().runAsync('DELETE FROM motion_events WHERE session_id = ? AND t = ? AND kind = ?', sessionId, t, kind);
}

/** After logging in to an account on this phone: your earlier challenge times become the account's. */
export async function reassignPlayer(oldId: string, newId: string, name: string) {
  await getDb().runAsync('UPDATE attempts SET player_id = ?, player_name = ? WHERE player_id = ?', newId, name, oldId);
}
