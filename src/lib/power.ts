import { distance } from './geo';
import type { TrackPoint } from './types';

/**
 * Battery saver. Precise GPS (a fix every second) only matters while you're
 * skiing. On a lift or standing around, a fix every few seconds is plenty and
 * saves a lot of battery.
 */

/** precise: skiing · eco: lifts and short stops · sleep: auto-paused during a long break. */
export type GpsMode = 'precise' | 'eco' | 'sleep';

export const GPS_OPTIONS: Record<GpsMode, { timeInterval: number; distanceInterval: number }> = {
  precise: { timeInterval: 1000, distanceInterval: 2 },
  eco: { timeInterval: 5000, distanceInterval: 15 },
  sleep: { timeInterval: 60000, distanceInterval: 40 },
};

/** Standing still this long (lunch, café) auto-pauses: GPS drops to one fix a minute. */
export const AUTO_PAUSE_MS = 10 * 60 * 1000;
const STILL_RADIUS_M = 60;

/**
 * How long you've been standing still at the end of the track (ms): all fixes
 * since then are within 60 m of the latest one and slow.
 */
export function restingFor(points: TrackPoint[]): number {
  const last = points[points.length - 1];
  if (!last) return 0;
  let since = last.t;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i];
    const moving = p.spd != null && Number.isFinite(p.spd) && p.spd > 1.5;
    if (moving || distance(p, last) > STILL_RADIUS_M) break;
    since = p.t;
  }
  return last.t - since;
}

/**
 * Picks the GPS mode from the last minute of fixes:
 * - stopped (barely moving for 45 s) → eco
 * - riding a lift (steady climb ≥ 0.4 m/s over 45 s) → eco
 * - anything fast or downhill → precise, straight away
 * Hysteresis: staying in the current mode is the default when it's unclear.
 */
export function decideGpsMode(recent: TrackPoint[], current: GpsMode): GpsMode {
  if (recent.length < 2) return current;
  // Long break: sleep until you move again (a fix that has moved away, or real speed).
  if (restingFor(recent) >= AUTO_PAUSE_MS) return 'sleep';
  if (current === 'sleep') {
    const l = recent[recent.length - 1], p = recent[recent.length - 2];
    const moved = distance(l, p) > STILL_RADIUS_M || (l.spd != null && l.spd > 1.5);
    return moved ? 'precise' : 'sleep';
  }
  const last = recent[recent.length - 1];
  const window = recent.filter((p) => last.t - p.t <= 45000);
  if (window.length < 2) return current;
  const first = window[0];
  const dt = (last.t - first.t) / 1000;
  if (dt < 20) return current;

  // Speed: the receiver's Doppler speed (median, robust to spikes) when available. Otherwise
  // straight-line displacement — summing the path would turn GPS jitter into fake movement.
  const dop = window.map((p) => p.spd).filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  const avg = dop.length >= window.length / 2
    ? dop.slice().sort((a, b) => a - b)[dop.length >> 1]
    : distance(first, last) / dt;
  const lastSpeed = last.spd != null && Number.isFinite(last.spd) ? last.spd : avg;
  // Climb rate from the average of the first and last few fixes, so one noisy altitude can't flip it.
  const alts = window.map((p) => p.alt).filter((a): a is number => a != null && Number.isFinite(a));
  const k = Math.min(5, alts.length >> 1);
  const climb = k > 0 ? (avgOf(alts.slice(-k)) - avgOf(alts.slice(0, k))) / dt : 0;

  // Any sign of skiing: go precise immediately.
  if (lastSpeed > 6 || climb < -0.5) return 'precise';
  if (avg < 0.8) return 'eco'; // standing / queueing / lunch
  if (climb >= 0.4 && avg <= 8) return 'eco'; // on a lift
  return current === 'eco' && avg < 3 ? 'eco' : 'precise';
}

function avgOf(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Hours of tracking left at the current drain rate, or null if it's too early to tell.
 * `level` values are 0..1.
 */
export function batteryHoursLeft(startLevel: number, startT: number, level: number, now: number): number | null {
  const hours = (now - startT) / 3600000;
  const used = startLevel - level;
  if (hours < 0.25 || used < 0.02 || level <= 0) return null;
  return level / (used / hours);
}

/** Text for the Android tracking notification. */
export function notificationBody(stats: { runCount: number; verticalDown: number; topSpeed: number }, fmt: {
  alt: (m: number) => string; speed: (mps: number) => string;
}): string {
  const runs = `${stats.runCount} ${stats.runCount === 1 ? 'run' : 'runs'}`;
  return `${runs} · ${fmt.alt(stats.verticalDown)} ↓ · top ${fmt.speed(stats.topSpeed)}`;
}
