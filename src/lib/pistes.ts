import { distance, localProjector, type LatLon } from './geo';
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
// OpenStreetMap has a piste's centre line; wide pistes put you 40–50 m from it.
const ON_PISTE_M = 50;
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
  return `[out:json][timeout:40];(way["piste:type"="downhill"](${bb});relation["piste:type"="downhill"](${bb});way["aerialway"~"^(${LIFT_TYPES.join('|')})$"](${bb}););out geom tags;`;
}

/** Lift kinds we draw and name (OSM aerialway=*). */
export const LIFT_TYPES = [
  'chair_lift', 'gondola', 'cable_car', 'mixed_lift', 'drag_lift', 't-bar', 'j-bar', 'platter', 'rope_tow', 'magic_carpet', 'funicular',
];

const LIFT_LABEL: Record<string, string> = {
  chair_lift: 'Chairlift', gondola: 'Gondola', cable_car: 'Cable car', mixed_lift: 'Chairlift/gondola',
  drag_lift: 'Drag lift', 't-bar': 'T-bar', 'j-bar': 'J-bar', platter: 'Platter lift', rope_tow: 'Rope tow',
  magic_carpet: 'Magic carpet', funicular: 'Funicular',
};

export interface Lift {
  id: string;
  name: string | null;
  type: string;
  coords: LatLon[];
}

export function liftLabel(type: string): string {
  return LIFT_LABEL[type] ?? 'Lift';
}

/** Lifts in an Overpass response. */
export function parseLifts(json: unknown): Lift[] {
  const els = (json as { elements?: OverpassElement[] })?.elements;
  if (!Array.isArray(els)) return [];
  const out: Lift[] = [];
  for (const el of els) {
    const type = el.tags?.aerialway;
    if (el.type !== 'way' || !type || !LIFT_TYPES.includes(type)) continue;
    const g = el.geometry;
    if (!Array.isArray(g) || g.length < 2 || !g.every((p) => p && typeof p.lat === 'number' && typeof p.lon === 'number')) continue;
    out.push({ id: `l${el.id}`, name: el.tags?.name?.slice(0, 40) ?? null, type, coords: g });
  }
  return out;
}

/**
 * Names each lift ride after the OSM lift it followed: its start must be near
 * one end of the lift line and its end near the other.
 */
export function matchLiftRides(points: TrackPoint[], rides: Activity[], lifts: Lift[], endTolerance = 120): Record<string, PisteMatch> {
  const result: Record<string, PisteMatch> = {};
  for (const ride of rides) {
    if (ride.kind !== 'lift') continue;
    const a = points[ride.startIndex], b = points[ride.endIndex];
    let best: { lift: Lift; err: number } | null = null;
    for (const lift of lifts) {
      const lo = lift.coords[0], hi = lift.coords[lift.coords.length - 1];
      const err = Math.min(distance(a, lo) + distance(b, hi), distance(a, hi) + distance(b, lo));
      if (err <= 2 * endTolerance && (!best || err < best.err)) best = { lift, err };
    }
    if (best) {
      const label = liftLabel(best.lift.type);
      result[String(ride.startTime)] = {
        name: best.lift.name ? `${best.lift.name} · ${label}` : label,
        difficulty: null,
        coverage: 1,
      };
    }
  }
  return result;
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
    // The same response also holds lifts: only downhill pistes count here.
    if (el.tags?.['piste:type'] !== 'downhill') continue;
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
    // One run often follows several pistes (a red into a blue…). It counts as on piste
    // when it was on *some* piste most of the way, and is named after the one it used most.
    const onAny = new Set<number>();
    for (const e of byKey.values()) e.hits.forEach((h) => onAny.add(h));
    let best: PisteMatch | null = null;
    for (const e of byKey.values()) {
      const coverage = e.hits.size / samples.length;
      const better = !best || coverage > best.coverage || (coverage === best.coverage && e.name && !best.name);
      if (better) best = { name: e.name, difficulty: e.difficulty, coverage };
    }
    if (best && onAny.size / samples.length >= MIN_COVERAGE && (best.name || best.difficulty)) {
      result[String(run.startTime)] = { ...best, coverage: onAny.size / samples.length };
    }
  }
  return result;
}

/** Colour for a piste difficulty (European convention, green for beginner areas). */
/** `dark`: drawn on a dark UI surface (black runs become light). Maps stay light, so leave it off there. */
export function difficultyColor(d: Difficulty, dark = false): string {
  switch (d) {
    case 'novice': return '#2E9E4F';
    case 'easy': return '#2F6FDE';
    case 'intermediate': return '#D33A2F';
    case 'advanced': case 'expert': return dark ? '#E8ECF1' : '#111111';
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
