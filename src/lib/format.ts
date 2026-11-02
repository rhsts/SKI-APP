import type { Units } from './types';

const KMH = 3.6;
const MPH = 2.236936;
const FT = 3.28084;
const MI = 1609.344;

export function speedValue(mps: number, units: Units): number {
  return mps * (units === 'metric' ? KMH : MPH);
}

export function speedUnit(units: Units) {
  return units === 'metric' ? 'km/h' : 'mph';
}

export function fmtSpeed(mps: number, units: Units, withUnit = true): string {
  const v = speedValue(mps, units).toFixed(1);
  return withUnit ? `${v} ${speedUnit(units)}` : v;
}

/** Vertical / altitude: metres or feet, no decimals. */
export function fmtAlt(m: number | null | undefined, units: Units, withUnit = true): string {
  if (m == null || !Number.isFinite(m)) return '–';
  const v = Math.round(units === 'metric' ? m : m * FT).toLocaleString('en-US');
  return withUnit ? `${v} ${units === 'metric' ? 'm' : 'ft'}` : v;
}

/** Horizontal distance: km / mi with one decimal, or m / ft when short. */
export function fmtDist(m: number, units: Units): string {
  if (units === 'metric') return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  const mi = m / MI;
  return mi < 0.2 ? `${Math.round(m * FT)} ft` : `${mi.toFixed(1)} mi`;
}

/** 1h 05m, 12m 30s, 45s */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

/** Stopwatch style 1:02:03 / 2:03 */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** Race times: 48.2s, 1:23.4, 1:02:03.4 */
export function fmtRaceTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const s = Math.floor(tenths / 10), d = tenths % 10;
  if (s < 60) return `${s}.${d}s`;
  return `${fmtClock(s)}.${d}`;
}

/** Gap to a rival: +1.3s / −0.8s */
export function fmtDelta(seconds: number): string {
  const v = Math.abs(seconds).toFixed(1);
  return seconds > 0.05 ? `+${v}s` : seconds < -0.05 ? `−${v}s` : '±0.0s';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtTimeOfDay(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
