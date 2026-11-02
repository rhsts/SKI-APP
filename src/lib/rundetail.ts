import { distance } from './geo';
import type { Activity, TrackPoint } from './types';

export interface RunDetail {
  /** Steepness of the whole run, in degrees. */
  avgSlopeDeg: number;
  /** Steepest stretch (over at least `window` m of ground), in degrees. */
  maxSlopeDeg: number;
  /** Index (in the cleaned track) where the steepest stretch starts. */
  steepestAt: number | null;
  /** Fastest moment (index in the cleaned track). */
  topSpeedAt: number;
}

const deg = (rise: number, run: number) => (run > 0 ? (Math.atan(rise / run) * 180) / Math.PI : 0);

/**
 * Steepness and key moments of one run. Slopes are measured over ≥ 30 m of
 * horizontal distance so GPS jitter doesn't create fake cliffs.
 */
export function runDetail(points: TrackPoint[], alts: (number | null)[], speeds: number[], run: Activity, window = 30): RunDetail {
  const s = run.startIndex, e = run.endIndex;
  let topAt = s;
  for (let i = s; i <= e; i++) if ((speeds[i] ?? 0) > (speeds[topAt] ?? 0)) topAt = i;

  const horiz: number[] = [0];
  for (let i = s + 1; i <= e; i++) horiz.push(horiz[horiz.length - 1] + distance(points[i - 1], points[i]));
  let maxDeg = 0, steepestAt: number | null = null, j = 0;
  for (let i = 0; i < horiz.length; i++) {
    while (j < horiz.length - 1 && horiz[j] - horiz[i] < window) j++;
    if (horiz[j] - horiz[i] < window) break;
    const a0 = alts[s + i], a1 = alts[s + j];
    if (a0 == null || a1 == null) continue;
    const d = deg(a0 - a1, horiz[j] - horiz[i]);
    if (d > maxDeg) { maxDeg = d; steepestAt = s + i; }
  }
  return { avgSlopeDeg: deg(run.verticalDown, horiz[horiz.length - 1]), maxSlopeDeg: maxDeg, steepestAt, topSpeedAt: topAt };
}
