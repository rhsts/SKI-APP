import { distance } from './geo';
import type { Segment } from './segments';
import type { Activity, TrackPoint } from './types';

/**
 * "You skied this run 3 times today, make it a challenge?"
 * Groups the day's runs that start and end in the same places and are about
 * the same length, and skips anything that's already a challenge.
 */

const SAME_PLACE_M = 60;
const MIN_LENGTH_M = 300;

export interface Suggestion {
  /** Index in the day's activities of the run to build the challenge from (the fastest of the group). */
  activityIndex: number;
  times: number;
  length: number;
}

export function suggestChallenges(points: TrackPoint[], activities: Activity[], existing: Segment[]): Suggestion[] {
  const runs = activities
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.kind === 'run' && a.distance >= MIN_LENGTH_M);
  const groups: { a: Activity; i: number }[][] = [];
  for (const r of runs) {
    const s = points[r.a.startIndex], e = points[r.a.endIndex];
    const g = groups.find((grp) => {
      const f = grp[0].a;
      return (
        distance(points[f.startIndex], s) <= SAME_PLACE_M &&
        distance(points[f.endIndex], e) <= SAME_PLACE_M &&
        Math.abs(f.distance - r.a.distance) <= 0.25 * Math.max(f.distance, r.a.distance)
      );
    });
    if (g) g.push(r);
    else groups.push([r]);
  }

  const covered = (s: TrackPoint, e: TrackPoint) =>
    existing.some((seg) => {
      const a = seg.path[0], b = seg.path[seg.path.length - 1];
      return (
        distance({ lat: a[0], lon: a[1] }, s) <= SAME_PLACE_M * 2 &&
        distance({ lat: b[0], lon: b[1] }, e) <= SAME_PLACE_M * 2
      );
    });

  return groups
    .filter((g) => g.length >= 2)
    .filter((g) => !covered(points[g[0].a.startIndex], points[g[0].a.endIndex]))
    .map((g) => {
      const fastest = g.reduce((m, r) => (r.a.duration < m.a.duration ? r : m));
      return { activityIndex: fastest.i, times: g.length, length: fastest.a.distance };
    })
    .sort((x, y) => y.times - x.times);
}
