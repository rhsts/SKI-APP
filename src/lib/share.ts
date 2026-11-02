import { attemptId, GHOST_SAMPLES, leaderboard, type Attempt, type PathPoint, type Segment } from './segments';

/**
 * Challenge links. Everything a friend needs (the course, the gates and the
 * leaderboard with ghosts) is packed into one URL-safe code, so no server or
 * account is needed. The same code is used to send your time back.
 */

export const SHARE_VERSION = 1;
const MAX_RESULTS = 10;

// ---------- compact number encoding (Google polyline varints) ----------

export function encodeInts(nums: number[]): string {
  let out = '';
  let prev = 0;
  for (const n of nums) {
    let v = Math.round(n) - prev;
    prev = Math.round(n);
    v = v < 0 ? ~(v << 1) : v << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>>= 5;
    }
    out += String.fromCharCode(v + 63);
  }
  return out;
}

export function decodeInts(str: string): number[] {
  const out: number[] = [];
  let i = 0, prev = 0;
  while (i < str.length) {
    let shift = 0, result = 0, b: number;
    do {
      if (i >= str.length) throw new Error('truncated');
      b = str.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) throw new Error('bad char');
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (shift > 30) throw new Error('overflow');
    } while (b >= 0x20);
    prev += result & 1 ? ~(result >> 1) : result >> 1;
    out.push(prev);
  }
  return out;
}

// ---------- UTF-8 + base64url (works on Hermes without TextEncoder/btoa) ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8(str: string): number[] {
  const out: number[] = [];
  for (const ch of str) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function fromUtf8(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let c: number;
    if (b < 0x80) c = b;
    else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    s += String.fromCodePoint(c);
  }
  return s;
}

export function toBase64Url(str: string): string {
  const b = utf8(str);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) out += B64[(n >> 6) & 63];
    if (i + 2 < b.length) out += B64[n & 63];
  }
  return out;
}

export function fromBase64Url(s: string): string {
  const bytes: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad base64');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return fromUtf8(bytes);
}

// ---------- payload ----------

export interface ChallengePayload {
  segment: Segment;
  attempts: Attempt[];
  fromName: string | null;
}

interface Wire {
  v: number;
  id: string;
  n: string;
  c: string | null;
  r: number; // gate radius
  t: number; // created at
  p: string; // "lats,lons" as polyline varints
  a?: string; // altitudes
  f: string | null; // sent by
  l: { i: string; n: string; t: number; d: number; g?: string }[];
}

/** Packs a challenge (course + best time per player) into a URL-safe code. */
export function encodeChallenge(segment: Segment, attempts: Attempt[], fromName: string | null): string {
  const lats = segment.path.map((p) => p[0] * 1e5);
  const lons = segment.path.map((p) => p[1] * 1e5);
  const hasAlt = segment.path.every((p) => p[2] != null);
  const wire: Wire = {
    v: SHARE_VERSION,
    id: segment.id,
    n: segment.name,
    c: segment.creatorName,
    r: segment.gateRadius,
    t: Math.round(segment.createdAt / 1000),
    p: `${encodeInts(lats)},${encodeInts(lons)}`,
    f: fromName,
    l: leaderboard(attempts).slice(0, MAX_RESULTS).map((e) => ({
      i: e.playerId,
      n: e.playerName,
      t: Math.round(e.time * 10),
      d: Math.round(e.at / 1000),
      ...(e.ghost ? { g: encodeInts(e.ghost.map((x) => x * 10)) } : {}),
    })),
  };
  if (hasAlt) wire.a = encodeInts(segment.path.map((p) => p[2] as number));
  return toBase64Url(JSON.stringify(wire));
}

const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 30);
  return s || fallback;
}

/** Unpacks and strictly validates a code from a link. Throws a readable error if it's broken. */
export function decodeChallenge(code: string): ChallengePayload {
  let w: Wire;
  try {
    w = JSON.parse(fromBase64Url(code.trim()));
  } catch {
    throw new Error('This invite link is broken or incomplete.');
  }
  if (!w || typeof w !== 'object') throw new Error('This invite link is broken.');
  if (w.v !== SHARE_VERSION) throw new Error('This invite was made with a newer version of the app. Please update.');
  if (typeof w.id !== 'string' || !ID_RE.test(w.id)) throw new Error('This invite link is broken.');
  if (typeof w.p !== 'string') throw new Error('This invite link is broken.');

  const [la, lo] = w.p.split(',');
  let lats: number[], lons: number[], alts: number[] | null = null;
  try {
    lats = decodeInts(la ?? '');
    lons = decodeInts(lo ?? '');
    if (typeof w.a === 'string') alts = decodeInts(w.a);
  } catch {
    throw new Error('This invite link is broken or incomplete.');
  }
  if (lats.length < 2 || lats.length !== lons.length || lats.length > 500 || (alts && alts.length !== lats.length)) {
    throw new Error('This invite link is broken or incomplete.');
  }
  const path: PathPoint[] = lats.map((v, i) => [v / 1e5, lons[i] / 1e5, alts ? alts[i] : null]);
  if (path.some(([lat, lon]) => Math.abs(lat) > 90 || Math.abs(lon) > 180)) throw new Error('This invite link is broken.');

  const segment: Segment = {
    id: w.id,
    name: cleanName(w.n, 'Challenge'),
    creatorName: w.c == null ? null : cleanName(w.c, 'A friend'),
    gateRadius: typeof w.r === 'number' && w.r >= 10 && w.r <= 100 ? w.r : 30,
    createdAt: typeof w.t === 'number' && w.t > 0 ? w.t * 1000 : Date.now(),
    path,
  };

  const attempts: Attempt[] = [];
  for (const r of Array.isArray(w.l) ? w.l.slice(0, MAX_RESULTS) : []) {
    if (!r || typeof r.i !== 'string' || !ID_RE.test(r.i)) continue;
    if (typeof r.t !== 'number' || r.t <= 0 || r.t > 36000) continue;
    if (typeof r.d !== 'number' || r.d <= 0) continue;
    let ghost: number[] | null = null;
    if (typeof r.g === 'string') {
      try {
        const g = decodeInts(r.g).map((x) => x / 10);
        if (g.length === GHOST_SAMPLES + 1 && g.every((x, k) => x >= 0 && (k === 0 || x >= g[k - 1]))) ghost = g;
      } catch {
        ghost = null;
      }
    }
    const at = r.d * 1000;
    attempts.push({
      id: attemptId(r.i, at),
      segmentId: segment.id,
      sessionId: null,
      playerId: r.i,
      playerName: cleanName(r.n, 'Skier'),
      time: r.t / 10,
      at,
      ghost,
    });
  }
  return { segment, attempts, fromName: w.f == null ? null : cleanName(w.f, 'A friend') };
}

/** Finds a challenge code in a link or in a whole pasted message. */
export function extractCode(text: string): string | null {
  const m = text.match(/[?&#]d=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  const bare = text.trim();
  return /^[A-Za-z0-9_-]{40,}$/.test(bare) ? bare : null;
}
