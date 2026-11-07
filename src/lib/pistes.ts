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
  /** Mapped as an area (closed outline of the whole slope), not a centre line. */
  area?: boolean;
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
      const g = el.geometry, first = g[0], last = g[g.length - 1];
      const area = el.tags?.area === 'yes' && g.length >= 4 && first.lat === last.lat && first.lon === last.lon;
      out.push({ id: `w${el.id}`, name: nameOf(el.tags), difficulty: difficultyOf(el.tags), coords: g, area });
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

  // Inside a piste mapped as an area = on it, however far from its outline.
  const inside = (q: { x: number; y: number }, xy: { x: number; y: number }[]) => {
    let c = false;
    for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
      const a = xy[i], b = xy[j];
      if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };

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
    // About 60 samples evenly spaced along the way down, so standing still somewhere
    // (waiting for friends at the edge of the piste) doesn't outweigh the skiing.
    const xy = points.slice(run.startIndex, run.endIndex + 1).map(toXY);
    let path = 0;
    for (let i = 1; i < xy.length; i++) path += Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
    const step = path / 60;
    const samples = xy.slice(0, 1);
    for (let i = 1, gone = 0; i < xy.length; i++) {
      gone += Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y);
      if (gone >= step) { samples.push(xy[i]); gone = 0; }
    }
    if (!samples.length) continue;
    // Merge coverage of pieces of the same named piste (a piste is often several OSM ways).
    const byKey = new Map<string, { name: string | null; difficulty: Difficulty; hits: Set<number> }>();
    for (const { piste, xy } of lines) {
      const key = piste.name ?? piste.id;
      let entry = byKey.get(key);
      samples.forEach((q, i) => {
        if ((piste.area && inside(q, xy)) || distTo(q, xy) <= ON_PISTE_M) {
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
    // Name after the piste used most; OSM often has the name on one piece (a route) and
    // the difficulty on another (the way, or an unnamed area), so fill in what's missing.
    const ranked = [...byKey.values()].sort((a, b) => b.hits.size - a.hits.size);
    const name = ranked.find((e) => e.name)?.name ?? null;
    const difficulty = ranked.find((e) => e.name === name && e.difficulty)?.difficulty ?? ranked.find((e) => e.difficulty)?.difficulty ?? null;
    const coverage = onAny.size / samples.length;
    if (coverage >= MIN_COVERAGE && (name || difficulty)) {
      result[String(run.startTime)] = { name, difficulty, coverage };
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
