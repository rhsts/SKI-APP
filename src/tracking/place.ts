import * as Location from 'expo-location';
import type { TrackPoint } from '../lib/types';

const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Names the place you skied, e.g. "Ischgl, Tyrol". Uses the lowest point of the
 * day (usually the village at the base) because summits rarely have a town name.
 * Returns null when offline or when nothing useful comes back; the user can
 * rename the day later.
 */
export async function lookupPlace(points: TrackPoint[]): Promise<string | null> {
  if (!points.length) return null;
  let base = points[0];
  for (const p of points) if (p.alt != null && (base.alt == null || p.alt < base.alt)) base = p;
  try {
    // On weak mountain signal the lookup can hang; Finish waits for it, so give up after a while.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const [a] = await Promise.race([
      Location.reverseGeocodeAsync({ latitude: base.lat, longitude: base.lon }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), LOOKUP_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer));
    if (!a) return null;
    const local = a.city || a.district || a.subregion || a.name;
    const parts = [local, a.region && a.region !== local ? a.region : null].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  } catch {
    return null;
  }
}
