import type { TrackPoint } from './types';

export interface PhotoPlace {
  t: number;
  lat: number;
  lon: number;
  /** How the place was found: the photo's own GPS tag, or its time matched to your track. */
  source: 'gps' | 'time';
}

/** "2026:01:17 10:12:33" (camera local time) → epoch ms in the phone's time zone. */
export function parseExifDate(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isFinite(t) ? t : null;
}

function exifCoord(v: unknown, ref: unknown): number | null {
  let n: number | null = null;
  if (typeof v === 'number') n = v;
  else if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')) n = v[0] + v[1] / 60 + v[2] / 3600;
  else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) n = Number(v);
  if (n == null || !Number.isFinite(n)) return null;
  return ref === 'S' || ref === 'W' ? -Math.abs(n) : n;
}

/** The track position at time t (linear between fixes), or null if t is outside the day. */
export function positionAt(points: TrackPoint[], t: number, slackMs = 10 * 60 * 1000): { lat: number; lon: number } | null {
  if (!points.length || t < points[0].t - slackMs || t > points[points.length - 1].t + slackMs) return null;
  if (t <= points[0].t) return points[0];
  if (t >= points[points.length - 1].t) return points[points.length - 1];
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const u = (t - a.t) / Math.max(1, b.t - a.t);
  return { lat: a.lat + u * (b.lat - a.lat), lon: a.lon + u * (b.lon - a.lon) };
}

/**
 * Where on the day a photo belongs. Uses the photo's GPS tag when present,
 * otherwise its capture time matched to your track. Returns null for photos
 * that weren't taken during this day.
 */
export function placePhoto(exif: Record<string, unknown> | null | undefined, points: TrackPoint[], fallbackTime?: number | null): PhotoPlace | null {
  const e = exif ?? {};
  const t = parseExifDate(e.DateTimeOriginal ?? e.DateTimeDigitized ?? e.DateTime) ?? fallbackTime ?? null;
  const lat = exifCoord(e.GPSLatitude, e.GPSLatitudeRef);
  const lon = exifCoord(e.GPSLongitude, e.GPSLongitudeRef);
  const first = points[0], last = points[points.length - 1];
  const inDay = (x: number) => !!first && x >= first.t - 30 * 60000 && x <= last.t + 30 * 60000;
  if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) {
    if (t == null || inDay(t)) return { t: t ?? first?.t ?? 0, lat, lon, source: 'gps' };
    return null;
  }
  if (t == null) return null;
  const p = positionAt(points, t);
  return p ? { t, lat: p.lat, lon: p.lon, source: 'time' } : null;
}
