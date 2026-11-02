import type { Activity } from './types';

/** Track index whose time is nearest to a touch at `x` on a chart `width` wide (time on the x axis). */
export function indexAtX(times: number[], x: number, width: number): number {
  const n = times.length;
  if (n === 0) return -1;
  if (n === 1 || width <= 0) return 0;
  const u = Math.max(0, Math.min(1, x / width));
  const t = times[0] + u * (times[n - 1] - times[0]);
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && t - times[lo - 1] < times[lo] - t ? lo - 1 : lo;
}

/** The run, lift or break that a track index falls in. */
export function activityAt(activities: Activity[], index: number): Activity | null {
  return activities.find((a) => index >= a.startIndex && index <= a.endIndex) ?? null;
}
