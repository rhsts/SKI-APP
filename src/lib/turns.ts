import { localProjector } from './geo';
import type { TrackPoint } from './types';

/**
 * Turns from the GPS track: your direction of travel swings left and right as
 * you turn. Every swing of at least `minSwing` counts as one turn, and the
 * sideways force of a turn is speed × how fast your direction changed.
 *
 * GPS gives one position a second, so this catches medium and long turns;
 * very short, quick turns blur together.
 */

export const TURNS = {
  minSwing: 0.45, // rad (~26°): smaller heading wobbles are GPS noise or a slight drift
  minBase: 8, // m: heading is measured over at least this distance
  maxG: 3, // anything above is a GPS glitch
};

export interface TurnStats {
  turns: number;
  /** Strongest turn's average sideways force, in g. */
  maxG: number;
}

const G = 9.81;

/** Turns between track indices `s` and `e` (inclusive). `spd` holds smoothed speeds for the whole track. */
export function analyseTurns(pts: TrackPoint[], s: number, e: number, spd: number[]): TurnStats {
  if (e - s < 6) return { turns: 0, maxG: 0 };
  const { toXY } = localProjector(pts[s]);
  const raw: { x: number; y: number }[] = [];
  for (let i = s; i <= e; i++) raw.push(toXY(pts[i]));
  // Light smoothing against GPS jitter.
  const xy = raw.map((p, i) => {
    if (i === 0 || i === raw.length - 1) return p;
    return { x: (raw[i - 1].x + p.x + raw[i + 1].x) / 3, y: (raw[i - 1].y + p.y + raw[i + 1].y) / 3 };
  });

  // Unwrapped heading at each point, carried over where we've barely moved.
  const heading: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[Math.max(0, i - 1)], b = xy[Math.min(xy.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.hypot(dx, dy) >= TURNS.minBase) {
      let h = Math.atan2(dy, dx);
      if (prev != null) {
        while (h - prev > Math.PI) h -= 2 * Math.PI;
        while (h - prev < -Math.PI) h += 2 * Math.PI;
      }
      prev = h;
    }
    heading.push(prev ?? NaN);
  }
  const first = heading.findIndex((h) => Number.isFinite(h));
  if (first < 0) return { turns: 0, maxG: 0 };
  for (let i = 0; i < first; i++) heading[i] = heading[first];

  // Pivots: where the heading stops swinging one way and swings back by at least minSwing.
  const T = TURNS.minSwing;
  const pivots = [0];
  let dir = 0, ext = 0, hi = 0, lo = 0;
  for (let i = 1; i < heading.length; i++) {
    const h = heading[i];
    if (dir === 0) {
      if (h > heading[hi]) hi = i;
      if (h < heading[lo]) lo = i;
      if (h - heading[lo] >= T) { dir = 1; ext = i; pivots[0] = lo; }
      else if (heading[hi] - h >= T) { dir = -1; ext = i; pivots[0] = hi; }
    } else if (dir === 1) {
      if (h >= heading[ext]) ext = i;
      else if (heading[ext] - h >= T) { pivots.push(ext); dir = -1; ext = i; }
    } else {
      if (h <= heading[ext]) ext = i;
      else if (h - heading[ext] >= T) { pivots.push(ext); dir = 1; ext = i; }
    }
  }
  if (dir === 0) return { turns: 0, maxG: 0 };
  pivots.push(ext);

  let turns = 0, maxG = 0;
  for (let k = 0; k < pivots.length - 1; k++) {
    const a = pivots[k], b = pivots[k + 1];
    const swing = Math.abs(heading[b] - heading[a]);
    if (swing < T || b <= a) continue;
    turns++;
    const dt = (pts[s + b].t - pts[s + a].t) / 1000;
    if (dt <= 0) continue;
    let v = 0;
    for (let i = a; i <= b; i++) v += spd[s + i] ?? 0;
    v /= b - a + 1;
    const g = (v * swing) / dt / G;
    if (g <= TURNS.maxG) maxG = Math.max(maxG, g);
  }
  return { turns, maxG };
}
