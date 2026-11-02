import * as Location from 'expo-location';
import type { TrackPoint } from '../lib/types';

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
    const [a] = await Location.reverseGeocodeAsync({ latitude: base.lat, longitude: base.lon });
    if (!a) return null;
    const local = a.city || a.district || a.subregion || a.name;
    const parts = [local, a.region && a.region !== local ? a.region : null].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  } catch {
    return null;
  }
}
