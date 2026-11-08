import { getPoints, getSession, newId, saveTrailMap, setSessionPistes, type SessionRow } from '../db';
import {
  bboxOf, matchLiftRides, matchRunsToPistes, OVERPASS_URL, overpassQuery, parseLifts, parseOverpass, type PisteMatch,
} from '../lib/pistes';
import { cleanTrack, computeStats } from '../lib/stats';
import { bboxAround, buildTrailMap, type TrailMap } from '../lib/trailmap';

/** Bump when the lookup gains something new, so older days are looked up again once. */
export const PISTES_VERSION = 6; // 6: half-finished Overpass answers were saved as if complete
export const VERSION_KEY = '_v';

export function pistesUpToDate(p: Record<string, PisteMatch> | null): boolean {
  return !!p && p[VERSION_KEY]?.coverage === PISTES_VERSION;
}

// The Overpass server is often busy for a moment: wait and ask again before giving up.
// (Other public Overpass servers were down when tried, so there's no fallback server.)
export const OVERPASS_RETRY = { waitsMs: [0, 10000, 30000] };

/** Downhill pistes and lifts in a box, from the free Overpass API. */
async function fetchOverpass(bbox: [number, number, number, number]): Promise<unknown | null> {
  const body = `data=${encodeURIComponent(overpassQuery(bbox))}`;
  for (const wait of OVERPASS_RETRY.waitsMs) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SkiTracker/1.0' },
        body,
        signal: controller.signal,
      });
      const json = res.ok ? ((await res.json()) as { elements?: unknown; remark?: unknown }) : null;
      // A busy server can stop halfway and still answer 200, with a "remark" and only some of the pistes.
      if (json && Array.isArray(json.elements) && json.remark == null) return json;
    } catch {
      // Unreachable or too slow: ask again.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Names a day's runs (piste + difficulty) and lift rides from OpenStreetMap,
 * and saves the area as an offline trail map. Needs internet; returns null if
 * the lookup failed, so it can simply be tried again later.
 */
export function lookupPistes(sessionId: string): Promise<Record<string, PisteMatch> | null> {
  // The day screen and the Season tab can ask for the same day at once: one lookup serves both.
  let p = inFlight.get(sessionId);
  if (!p) {
    p = lookup(sessionId).finally(() => inFlight.delete(sessionId));
    inFlight.set(sessionId, p);
  }
  return p;
}
const inFlight = new Map<string, Promise<Record<string, PisteMatch> | null>>();

async function lookup(sessionId: string): Promise<Record<string, PisteMatch> | null> {
  const session = await getSession(sessionId);
  if (!session || session.isDemo) return null; // demo days are on a made-up mountain
  const raw = await getPoints(sessionId);
  const pts = cleanTrack(raw);
  if (pts.length < 2) return null;
  const acts = computeStats(raw).activities;
  const bbox = bboxOf(pts);
  const json = await fetchOverpass(bbox);
  if (!json) return null;
  const matches: Record<string, PisteMatch> = {
    ...matchRunsToPistes(pts, acts.filter((a) => a.kind === 'run'), parseOverpass(json)),
    ...matchLiftRides(pts, acts.filter((a) => a.kind === 'lift'), parseLifts(json)),
    [VERSION_KEY]: { name: null, difficulty: null, coverage: PISTES_VERSION },
  };
  await setSessionPistes(sessionId, matches);
  await saveTrailMap(buildTrailMap(json, bbox, `day-${sessionId}`)).catch(() => undefined);
  return matches;
}

const tried = new Set<string>();
let queue: Promise<void> = Promise.resolve();

/**
 * Looks up pistes in the background for finished days whose names are missing or
 * stale, one day at a time (Overpass is rate-limited) and each at most once per
 * app run; failed days are simply tried again next app start.
 */
export function lookupStalePistes(
  days: SessionRow[],
  onFound: (id: string, pistes: Record<string, PisteMatch>) => void,
): Promise<void> {
  const todo = days.filter((d) => d.endedAt != null && !d.isDemo && !pistesUpToDate(d.pistes) && !tried.has(d.id));
  todo.forEach((d) => tried.add(d.id));
  queue = queue.then(async () => {
    for (const d of todo) {
      const p = await lookupPistes(d.id).catch(() => null);
      if (p) onFound(d.id, p);
    }
  });
  return queue;
}

/** Downloads the pistes and lifts around a point (about 6 km each way) for offline use. */
export async function downloadTrailMap(lat: number, lon: number): Promise<TrailMap | null> {
  const bbox = bboxAround(lat, lon, 6);
  const json = await fetchOverpass(bbox);
  if (!json) return null;
  const map = buildTrailMap(json, bbox, `area-${newId()}`);
  await saveTrailMap(map);
  return map;
}
