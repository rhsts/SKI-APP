import type { TrackPoint } from './types';

/**
 * Barometer + GPS altitude.
 *
 * Phone GPS altitude jumps around by ±10 m or more; air pressure measures height
 * changes to well under a metre. But pressure also drifts with the weather, so
 * we use the barometer for the shape (ups and downs) and pin its level to GPS
 * with a slowly-varying offset: the median difference over a 10-minute window.
 */

const SEA_LEVEL_HPA = 1013.25;
const WINDOW_MS = 10 * 60 * 1000;
const MIN_COVERAGE = 0.6; // share of fixes that need a pressure reading

/** International barometric formula: pressure (hPa) → altitude (m) in a standard atmosphere. */
export function pressureToAltitude(hPa: number): number {
  return 44330 * (1 - Math.pow(hPa / SEA_LEVEL_HPA, 1 / 5.255));
}

/** Inverse of pressureToAltitude, used by the simulator. */
export function altitudeToPressure(m: number): number {
  return SEA_LEVEL_HPA * Math.pow(1 - m / 44330, 5.255);
}

function median(xs: number[]): number {
  const a = xs.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** True when enough fixes carry a barometer reading to trust it. */
export function hasBarometer(points: TrackPoint[]): boolean {
  if (!points.length) return false;
  let n = 0;
  for (const p of points) if (p.pres != null && Number.isFinite(p.pres) && p.pres > 300 && p.pres < 1100) n++;
  return n / points.length >= MIN_COVERAGE;
}

/**
 * Returns the points with `alt` replaced by barometric altitude, levelled to GPS.
 * Points without pressure get the value interpolated from their neighbours.
 * If there's too little barometer data (or no GPS altitude to level against),
 * the points are returned unchanged.
 */
export function fuseAltitude(points: TrackPoint[]): TrackPoint[] {
  if (!hasBarometer(points)) return points;
  const n = points.length;
  const baro: (number | null)[] = points.map((p) =>
    p.pres != null && Number.isFinite(p.pres) && p.pres > 300 && p.pres < 1100 ? pressureToAltitude(p.pres) : null,
  );
  // Fill gaps by linear interpolation in time (and hold the ends).
  const known = baro.map((b, i) => (b != null ? i : -1)).filter((i) => i >= 0);
  const filled = new Array<number>(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < known.length - 1 && known[k + 1] <= i) k++;
    const a = known[k], b = known[Math.min(k + 1, known.length - 1)];
    if (baro[i] != null) filled[i] = baro[i] as number;
    else if (i <= known[0]) filled[i] = baro[known[0]] as number;
    else if (i >= known[known.length - 1]) filled[i] = baro[known[known.length - 1]] as number;
    else {
      const u = (points[i].t - points[a].t) / Math.max(1, points[b].t - points[a].t);
      filled[i] = (baro[a] as number) + u * ((baro[b] as number) - (baro[a] as number));
    }
  }

  // Offset to GPS: median(gps - baro) over a sliding window, sampled every minute and interpolated.
  const diffs: { t: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    const g = points[i].alt;
    if (g != null && Number.isFinite(g)) diffs.push({ t: points[i].t, d: g - filled[i] });
  }
  if (diffs.length < 10) return points;
  const t0 = points[0].t, t1 = points[n - 1].t;
  const anchors: { t: number; off: number }[] = [];
  let lo = 0, hi = 0;
  for (let t = t0; t <= t1 + 60000; t += 60000) {
    while (lo < diffs.length && diffs[lo].t < t - WINDOW_MS / 2) lo++;
    while (hi < diffs.length && diffs[hi].t <= t + WINDOW_MS / 2) hi++;
    const win = diffs.slice(lo, hi).map((x) => x.d);
    if (win.length >= 5) anchors.push({ t, off: median(win) });
  }
  if (!anchors.length) anchors.push({ t: t0, off: median(diffs.map((x) => x.d)) });
  let j = 0;
  return points.map((p, i) => {
    while (j < anchors.length - 1 && anchors[j + 1].t <= p.t) j++;
    const A = anchors[j], B = anchors[Math.min(j + 1, anchors.length - 1)];
    const u = B.t > A.t ? Math.max(0, Math.min(1, (p.t - A.t) / (B.t - A.t))) : 0;
    return { ...p, alt: filled[i] + A.off + u * (B.off - A.off) };
  });
}
