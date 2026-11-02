import { distance } from './geo';
import type { DayStats, TrackPoint } from './types';

export interface CompareRow {
  key: string;
  label: string;
  a: number;
  b: number;
  /** Which day is better on this row (higher is better for all of these). */
  winner: 'a' | 'b' | 'tie';
  kind: 'speed' | 'alt' | 'dist' | 'duration' | 'count';
}

/** Side-by-side stats for two days. */
export function compareDays(a: DayStats, b: DayStats): CompareRow[] {
  const fastestRun = (s: DayStats) => s.activities.filter((x) => x.kind === 'run').reduce((m, r) => Math.max(m, r.avgSpeed), 0);
  const rows: Omit<CompareRow, 'winner'>[] = [
    { key: 'top', label: 'Top speed', a: a.topSpeed, b: b.topSpeed, kind: 'speed' },
    { key: 'avg', label: 'Average ski speed', a: a.avgSkiSpeed, b: b.avgSkiSpeed, kind: 'speed' },
    { key: 'fastestRun', label: 'Fastest run (average)', a: fastestRun(a), b: fastestRun(b), kind: 'speed' },
    { key: 'vert', label: 'Vertical', a: a.verticalDown, b: b.verticalDown, kind: 'alt' },
    { key: 'runs', label: 'Runs', a: a.runCount, b: b.runCount, kind: 'count' },
    { key: 'ski', label: 'Ski time', a: a.skiTime, b: b.skiTime, kind: 'duration' },
    { key: 'dist', label: 'Distance skied', a: a.skiDistance, b: b.skiDistance, kind: 'dist' },
    { key: 'longest', label: 'Longest run', a: a.longestRun, b: b.longestRun, kind: 'dist' },
  ];
  return rows.map((r) => {
    const tol = Math.max(Math.abs(r.a), Math.abs(r.b)) * 0.005;
    return { ...r, winner: Math.abs(r.a - r.b) <= tol ? 'tie' : r.a > r.b ? 'a' : 'b' };
  });
}

/** True when two days were on the same mountain (their tracks come within 2 km). */
export function sameArea(a: TrackPoint[], b: TrackPoint[]): boolean {
  if (!a.length || !b.length) return false;
  const sample = (pts: TrackPoint[]) => pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 40)) === 0);
  const sa = sample(a), sb = sample(b);
  return sa.some((p) => sb.some((q) => distance(p, q) < 2000));
}
