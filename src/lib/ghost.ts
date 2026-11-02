import { distance, type LatLon } from './geo';
import { ghostTimeAt, type PathPoint } from './segments';

/** Number of sections a challenge is split into for split times. */
export const SPLITS = 3;

/** How far along the course (0..1) a ghost is after `t` seconds. Inverse of ghostTimeAt. */
export function progressAt(ghost: number[], t: number): number {
  const n = ghost.length - 1;
  if (n < 1) return 0;
  if (t <= ghost[0]) return 0;
  if (t >= ghost[n]) return 1;
  for (let k = 1; k <= n; k++) {
    if (ghost[k] >= t) {
      const dt = ghost[k] - ghost[k - 1];
      const u = dt > 0 ? (t - ghost[k - 1]) / dt : 1;
      return (k - 1 + u) / n;
    }
  }
  return 1;
}

/** The point a fraction (0..1) of the way along a course. */
export function pointAlong(path: PathPoint[], frac: number): LatLon {
  const pts = path.map(([lat, lon]) => ({ lat, lon }));
  if (pts.length === 1) return pts[0];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = distance(pts[i - 1], pts[i]);
    seg.push(d);
    total += d;
  }
  let target = Math.max(0, Math.min(1, frac)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const u = seg[i] > 0 ? Math.min(1, target / seg[i]) : 0;
      return { lat: pts[i].lat + u * (pts[i + 1].lat - pts[i].lat), lon: pts[i].lon + u * (pts[i + 1].lon - pts[i].lon) };
    }
    target -= seg[i];
  }
  return pts[pts.length - 1];
}

/** Time spent in each third of the course. */
export function splitTimes(ghost: number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let k = 1; k <= SPLITS; k++) {
    const t = ghostTimeAt(ghost, k / SPLITS);
    out.push(Math.round((t - prev) * 10) / 10);
    prev = t;
  }
  return out;
}

/**
 * Section-by-section gap between two runs (positive = `mine` was slower there).
 * Also names the section where most time was lost or gained.
 */
export function compareSplits(mine: number[], theirs: number[]) {
  const a = splitTimes(mine), b = splitTimes(theirs);
  const deltas = a.map((x, i) => Math.round((x - b[i]) * 10) / 10);
  let worst = 0, best = 0;
  deltas.forEach((d, i) => {
    if (d > deltas[worst]) worst = i;
    if (d < deltas[best]) best = i;
  });
  return { mine: a, theirs: b, deltas, worst: deltas[worst] > 0 ? worst : null, best: deltas[best] < 0 ? best : null };
}

export const SECTION_NAMES = ['top', 'middle', 'bottom'];
