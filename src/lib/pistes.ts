import { localProjector, type LatLon } from './geo';
import type { Activity, TrackPoint } from './types';

/**
 * Piste names from OpenStreetMap. We ask the free Overpass API for all downhill
 * pistes around your day, then name each run after the piste it followed most.
 */

export type Difficulty = 'novice' | 'easy' | 'intermediate' | 'advanced' | 'expert' | 'freeride' | null;

export interface Piste {
  id: string;
  name: string | null;
  difficulty: Difficulty;
  coords: LatLon[];
}

export interface PisteMatch {
  name: string | null;
  difficulty: Difficulty;
  /** Share of the run that was on this piste (0..1). */
  coverage: number;
}

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const ON_PISTE_M = 35;
const MIN_COVERAGE = 0.5;

/** Bounding box of a track with a margin, as [south, west, north, east]. */
export function bboxOf(points: LatLon[], marginDeg = 0.005): [number, number, number, number] {
  let s = 90, w = 180, n = -90, e = -180;
  for (const p of points) {
    s = Math.min(s, p.lat); n = Math.max(n, p.lat);
    w = Math.min(w, p.lon); e = Math.max(e, p.lon);
  }
  return [s - marginDeg, w - marginDeg, n + marginDeg, e + marginDeg];
}

export function overpassQuery([s, w, n, e]: [number, number, number, number]): string {
  const bb = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  return `[out:json][timeout:25];(way["piste:type"="downhill"](${bb});relation["piste:type"="downhill"](${bb}););out geom tags;`;
}

const DIFFICULTIES = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride'];

function nameOf(tags: Record<string, string> | undefined): string | null {
  if (!tags) return null;
  const n = tags['piste:name'] || tags.name;
  if (n) return n.slice(0, 40);
  return tags['piste:ref'] || tags.ref ? `Piste ${(tags['piste:ref'] || tags.ref).slice(0, 10)}` : null;
}

function difficultyOf(tags: Record<string, string> | undefined): Difficulty {
  const d = tags?.['piste:difficulty'];
  return d && DIFFICULTIES.includes(d) ? (d as Difficulty) : null;
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; geometry?: { lat: number; lon: number }[] }[];
}

/** Turns an Overpass response into pistes. Relations (named routes) override their member ways' names. */
export function parseOverpass(json: unknown): Piste[] {
  const els = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(els)) return [];
  const out: Piste[] = [];
  for (const el of els) {
    const geomOk = (g: unknown): g is { lat: number; lon: number }[] =>
      Array.isArray(g) && g.length >= 2 && g.every((p) => p && typeof p.lat === 'number' && typeof p.lon === 'number');
    if (el.type === 'way' && geomOk(el.geometry)) {
      out.push({ id: `w${el.id}`, name: nameOf(el.tags), difficulty: difficultyOf(el.tags), coords: el.geometry });
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      el.members.forEach((m, k) => {
        if (m.type === 'way' && geomOk(m.geometry)) {
          out.push({ id: `r${el.id}-${k}`, name: nameOf(el.tags), difficulty: difficultyOf(el.tags), coords: m.geometry });
        }
      });
    }
  }
  return out;
}

/** For each run, the piste it followed most (keyed by the run's start time). */
export function matchRunsToPistes(points: TrackPoint[], runs: Activity[], pistes: Piste[]): Record<string, PisteMatch> {
  const result: Record<string, PisteMatch> = {};
  if (!pistes.length || !points.length) return result;
  const { toXY } = localProjector(points[0]);
  const lines = pistes.map((p) => ({ piste: p, xy: p.coords.map(toXY) }));

  const distTo = (q: { x: number; y: number }, xy: { x: number; y: number }[]) => {
    let best = Infinity;
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i], b = xy[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0;
      const d = Math.hypot(a.x + t * dx - q.x, a.y + t * dy - q.y);
      if (d < best) best = d;
    }
    return best;
  };

  for (const run of runs) {
    if (run.kind !== 'run') continue;
    const slice = points.slice(run.startIndex, run.endIndex + 1);
    const step = Math.max(1, Math.floor(slice.length / 60));
    const samples = slice.filter((_, i) => i % step === 0).map(toXY);
    if (!samples.length) continue;
    // Merge coverage of pieces of the same named piste (a piste is often several OSM ways).
    const byKey = new Map<string, { name: string | null; difficulty: Difficulty; hits: Set<number> }>();
    for (const { piste, xy } of lines) {
      const key = piste.name ?? piste.id;
      let entry = byKey.get(key);
      samples.forEach((q, i) => {
        if (distTo(q, xy) <= ON_PISTE_M) {
          if (!entry) { entry = { name: piste.name, difficulty: piste.difficulty, hits: new Set() }; byKey.set(key, entry); }
          entry.hits.add(i);
          if (!entry.difficulty) entry.difficulty = piste.difficulty;
        }
      });
    }
    let best: PisteMatch | null = null;
    for (const e of byKey.values()) {
      const coverage = e.hits.size / samples.length;
      const better = !best || coverage > best.coverage || (coverage === best.coverage && e.name && !best.name);
      if (better) best = { name: e.name, difficulty: e.difficulty, coverage };
    }
    if (best && best.coverage >= MIN_COVERAGE && (best.name || best.difficulty)) result[String(run.startTime)] = best;
  }
  return result;
}

/** Colour for a piste difficulty (European convention, green for beginner areas). */
export function difficultyColor(d: Difficulty): string {
  switch (d) {
    case 'novice': return '#2E9E4F';
    case 'easy': return '#2F6FDE';
    case 'intermediate': return '#D33A2F';
    case 'advanced': case 'expert': return '#111111';
    case 'freeride': return '#E8892B';
    default: return '#8F9CAD';
  }
}

export function difficultyLabel(d: Difficulty): string | null {
  switch (d) {
    case 'novice': return 'Beginner';
    case 'easy': return 'Easy';
    case 'intermediate': return 'Intermediate';
    case 'advanced': return 'Advanced';
    case 'expert': return 'Expert';
    case 'freeride': return 'Freeride';
    default: return null;
  }
}
