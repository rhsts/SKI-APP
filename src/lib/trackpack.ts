import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { packPoints, unpackPoints } from './backup';
import type { MotionKind } from './motion';
import type { TrackPoint } from './types';

/**
 * A day as stored in your online backup: the GPS track and jumps/falls,
 * JSON → gzip → base64. A full day of 1 Hz GPS becomes a few hundred KB.
 */

export interface PackedDay {
  v: 1;
  startedAt: number;
  endedAt: number | null;
  place: string | null;
  sport: string;
  isDemo: boolean;
  points: TrackPoint[];
  motion: { t: number; kind: MotionKind; value: number; lat: number | null; lon: number | null }[];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

export function packDay(d: Omit<PackedDay, 'v'>): string {
  const json = JSON.stringify({ ...d, v: 1, points: packPoints(d.points) });
  return toBase64(gzipSync(strToU8(json), { level: 9 }));
}

export function unpackDay(data: string): PackedDay {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(strFromU8(gunzipSync(fromBase64(data))));
  } catch {
    throw new Error('This backup of the day is damaged.');
  }
  if (raw.v !== 1 || typeof raw.startedAt !== 'number') throw new Error('This backup was made by a newer version of the app.');
  const motion = Array.isArray(raw.motion)
    ? (raw.motion as PackedDay['motion']).filter((m) => m && typeof m.t === 'number' && (m.kind === 'jump' || m.kind === 'fall'))
    : [];
  return {
    v: 1,
    startedAt: raw.startedAt,
    endedAt: typeof raw.endedAt === 'number' ? raw.endedAt : null,
    place: typeof raw.place === 'string' ? raw.place : null,
    sport: typeof raw.sport === 'string' ? raw.sport : 'ski',
    isDemo: !!raw.isDemo,
    points: unpackPoints(raw.points),
    motion,
  };
}
