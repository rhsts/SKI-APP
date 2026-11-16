import { canSearch, geocodeUrl, parsePlaces, type Place } from '../lib/geocode';

/** Places matching a name. Throws when there is no connection, so the screen can say so. */
export async function searchPlaces(name: string): Promise<Place[]> {
  if (!canSearch(name)) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(geocodeUrl(name), { signal: controller.signal });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return parsePlaces(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
