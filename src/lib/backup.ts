import type { Attempt, PathPoint, Segment } from './segments';
import type { TrackPoint } from './types';

/**
 * Backup file: every day (with its raw GPS points) and every challenge, as JSON.
 * Stats are not stored: they're recomputed from the points on restore, so a
 * backup always benefits from the latest detection logic.
 */

export const BACKUP_APP = 'ski-tracker';
export const BACKUP_VERSION = 1;

export interface BackupDay {
  id: string;
  startedAt: number;
  endedAt: number | null;
  place: string | null;
  isDemo: boolean;
  /** [t, lat, lon, alt, acc, spd, pres] */
  points: (number | null)[][];
}

export interface Backup {
  app: typeof BACKUP_APP;
  v: number;
  exportedAt: number;
  days: BackupDay[];
  segments: Segment[];
  attempts: Attempt[];
}

export function packPoints(points: TrackPoint[]): (number | null)[][] {
  return points.map((p) => [p.t, p.lat, p.lon, p.alt, p.acc, p.spd, p.pres ?? null]);
}

export function unpackPoints(rows: unknown): TrackPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: TrackPoint[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const [t, lat, lon, alt, acc, spd, pres] = r;
    if (typeof t !== 'number' || typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    out.push({ t, lat, lon, alt: num(alt), acc: num(acc), spd: num(spd), pres: num(pres) });
  }
  return out;
}

export function buildBackup(days: BackupDay[], segments: Segment[], attempts: Attempt[], now = Date.now()): Backup {
  return { app: BACKUP_APP, v: BACKUP_VERSION, exportedAt: now, days, segments, attempts };
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

/** Parses and validates a backup file. Throws a readable error for anything that isn't one. */
export function parseBackup(text: string): Backup {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file isn’t a Ski Tracker backup.');
  }
  if (!raw || raw.app !== BACKUP_APP) throw new Error('This file isn’t a Ski Tracker backup.');
  if (typeof raw.v !== 'number' || raw.v > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app.');

  const days: BackupDay[] = [];
  for (const d of Array.isArray(raw.days) ? raw.days : []) {
    if (!d || typeof d.id !== 'string' || !ID_RE.test(d.id) || typeof d.startedAt !== 'number') continue;
    days.push({
      id: d.id,
      startedAt: d.startedAt,
      endedAt: typeof d.endedAt === 'number' ? d.endedAt : null,
      place: str(d.place, 80),
      isDemo: !!d.isDemo,
      points: Array.isArray(d.points) ? d.points : [],
    });
  }

  const segments: Segment[] = [];
  for (const s of Array.isArray(raw.segments) ? raw.segments : []) {
    if (!s || typeof s.id !== 'string' || !ID_RE.test(s.id) || !Array.isArray(s.path) || s.path.length < 2) continue;
    const path = (s.path as unknown[]).filter(
      (p): p is PathPoint => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number',
    );
    if (path.length < 2) continue;
    segments.push({
      id: s.id,
      name: str(s.name, 30) ?? 'Challenge',
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      creatorName: str(s.creatorName, 30),
      path,
      gateRadius: typeof s.gateRadius === 'number' ? s.gateRadius : 30,
    });
  }

  const attempts: Attempt[] = [];
  for (const a of Array.isArray(raw.attempts) ? raw.attempts : []) {
    if (!a || typeof a.id !== 'string' || !ID_RE.test(a.id) || typeof a.segmentId !== 'string') continue;
    if (typeof a.time !== 'number' || typeof a.at !== 'number' || typeof a.playerId !== 'string') continue;
    attempts.push({
      id: a.id,
      segmentId: a.segmentId,
      sessionId: typeof a.sessionId === 'string' ? a.sessionId : null,
      playerId: a.playerId,
      playerName: str(a.playerName, 30) ?? 'Skier',
      time: a.time,
      at: a.at,
      ghost: Array.isArray(a.ghost) && a.ghost.every((x: unknown) => typeof x === 'number') ? a.ghost : null,
    });
  }

  return { app: BACKUP_APP, v: raw.v, exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0, days, segments, attempts };
}
