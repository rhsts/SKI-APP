import { getPoints, getSession, newId, saveTrailMap, setSessionPistes } from '../db';
import {
  bboxOf, matchLiftRides, matchRunsToPistes, OVERPASS_URL, overpassQuery, parseLifts, parseOverpass, type PisteMatch,
} from '../lib/pistes';
import { cleanTrack, computeStats } from '../lib/stats';
import { bboxAround, buildTrailMap, type TrailMap } from '../lib/trailmap';

/** Bump when the lookup gains something new, so older days are looked up again once. */
export const PISTES_VERSION = 4;
export const VERSION_KEY = '_v';

export function pistesUpToDate(p: Record<string, PisteMatch> | null): boolean {
  return !!p && p[VERSION_KEY]?.coverage === PISTES_VERSION;
}

/** Downhill pistes and lifts in a box, from the free Overpass API. */
async function fetchOverpass(bbox: [number, number, number, number]): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SkiTracker/1.0' },
      body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
      signal: controller.signal,
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Names a day's runs (piste + difficulty) and lift rides from OpenStreetMap,
 * and saves the area as an offline trail map. Needs internet; returns null if
 * the lookup failed, so it can simply be tried again later.
 */
export async function lookupPistes(sessionId: string): Promise<Record<string, PisteMatch> | null> {
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

/** Downloads the pistes and lifts around a point (about 6 km each way) for offline use. */
export async function downloadTrailMap(lat: number, lon: number): Promise<TrailMap | null> {
  const bbox = bboxAround(lat, lon, 6);
  const json = await fetchOverpass(bbox);
  if (!json) return null;
  const map = buildTrailMap(json, bbox, `area-${newId()}`);
  await saveTrailMap(map);
  return map;
}
