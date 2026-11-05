import { strFromU8, unzipSync } from 'fflate';
import type { TrackPoint } from './types';

/**
 * Reads a day exported from the Slopes app (.slopes). It's a ZIP with:
 * - GPS.csv: one fix per line, `epoch seconds, lat, lon, altitude, course, speed, h-accuracy, v-accuracy`
 *   (altitude already corrected by Slopes),
 * - RawGPS.csv: the same before Slopes' corrections (altitude still off by `altitudeOffset`),
 * - Metadata.xml: resort name, Slopes' own totals, and time ranges you told Slopes to ignore.
 */

export interface SlopesDay {
  points: TrackPoint[];
  place: string | null;
  notes: string | null;
  /** Slopes' own totals, for comparison. */
  slopes: { vertical: number | null; topSpeed: number | null; distance: number | null; runs: number; lifts: number };
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function attr(xml: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(xml);
  return m ? decodeXml(m[1]) : null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

const num = (s: string | null) => {
  if (s == null || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/** "1771413370-1771419758:ignore,…" → ignored [from, to] ranges in ms. */
function ignoredRanges(overrides: string | null): [number, number][] {
  if (!overrides) return [];
  const out: [number, number][] = [];
  for (const part of overrides.split(/[,;\s]+/)) {
    const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?):ignore$/i.exec(part.trim());
    if (m) out.push([Number(m[1]) * 1000, Number(m[2]) * 1000]);
  }
  return out;
}

export function parseSlopesCsv(csv: string, altOffset = 0): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const c = line.split(',');
    if (c.length < 4) continue;
    const t = num(c[0]), lat = num(c[1]), lon = num(c[2]);
    if (t == null || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const alt = num(c[3]);
    const speed = num(c[5]);
    const hAcc = num(c[6]);
    out.push({
      t: Math.round(t * 1000),
      lat,
      lon,
      alt: alt == null ? null : alt - altOffset,
      acc: hAcc != null && hAcc >= 0 ? hAcc : null,
      spd: speed != null && speed >= 0 ? speed : null,
    });
  }
  out.sort((a, b) => a.t - b.t);
  return dropImpossibleSpeeds(out);
}

/**
 * Slopes sometimes fills a GPS glitch with made-up fixes at a fixed 80 m/s.
 * A reported speed far above how fast the position actually moved is dropped
 * (speed is then worked out from the positions instead).
 */
export function dropImpossibleSpeeds(points: TrackPoint[]): TrackPoint[] {
  return points.map((p, i) => {
    if (p.spd == null || p.spd < 15) return p;
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return p;
    const moved = haversine(a.lat, a.lon, b.lat, b.lon) / dt;
    return p.spd > moved * 2 + 5 ? { ...p, spd: null } : p;
  });
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function parseSlopes(bytes: Uint8Array): SlopesDay {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This isn’t a readable .slopes file.');
  }
  const find = (name: string) => {
    const key = Object.keys(files).find((k) => k.split('/').pop()?.toLowerCase() === name.toLowerCase());
    return key ? strFromU8(files[key]) : null;
  };
  const meta = find('Metadata.xml') ?? '';
  const activity = /<Activity\b[^>]*>/.exec(meta)?.[0] ?? '';

  // Prefer Slopes' corrected track; fall back to the raw one with the altitude offset applied.
  const gps = find('GPS.csv');
  const raw = gps ? null : find('RawGPS.csv');
  if (!gps && !raw) throw new Error('This .slopes file has no GPS track.');
  let points = gps ? parseSlopesCsv(gps) : parseSlopesCsv(raw!, num(attr(activity, 'altitudeOffset')) ?? 0);

  const ignore = ignoredRanges(attr(activity, 'overrides'));
  if (ignore.length) points = points.filter((p) => !ignore.some(([a, b]) => p.t >= a && p.t <= b));

  const actions = meta.match(/<Action\b[^>]*>/g) ?? [];
  return {
    points,
    place: attr(activity, 'locationName') || null,
    notes: attr(activity, 'notes') || null,
    slopes: {
      vertical: num(attr(activity, 'vertical')),
      topSpeed: num(attr(activity, 'topSpeed')),
      distance: num(attr(activity, 'distance')),
      runs: actions.filter((a) => attr(a, 'type') === 'Run').length,
      lifts: actions.filter((a) => attr(a, 'type') === 'Lift').length,
    },
  };
}
