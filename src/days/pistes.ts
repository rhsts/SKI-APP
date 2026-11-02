import { getPoints, getSession, setSessionPistes } from '../db';
import { bboxOf, matchRunsToPistes, OVERPASS_URL, overpassQuery, parseOverpass, type PisteMatch } from '../lib/pistes';
import { cleanTrack, computeStats } from '../lib/stats';

/**
 * Looks up piste names for a day from OpenStreetMap (needs internet) and saves
 * them. Returns the names, or null if the lookup failed (offline, server busy),
 * in which case it can simply be tried again later.
 */
export async function lookupPistes(sessionId: string): Promise<Record<string, PisteMatch> | null> {
  const session = await getSession(sessionId);
  if (!session || session.isDemo) return null; // demo days are on a made-up mountain
  const raw = await getPoints(sessionId);
  const pts = cleanTrack(raw);
  if (pts.length < 2) return null;
  const runs = computeStats(raw).activities.filter((a) => a.kind === 'run');
  if (!runs.length) {
    await setSessionPistes(sessionId, {});
    return {};
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SkiTracker/1.0' },
      body: `data=${encodeURIComponent(overpassQuery(bboxOf(pts)))}`,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const matches = matchRunsToPistes(pts, runs, parseOverpass(await res.json()));
    await setSessionPistes(sessionId, matches);
    return matches;
  } catch {
    return null;
  }
}
