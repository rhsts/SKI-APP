import { kvGet, kvSet } from '../db';
import { distance } from '../lib/geo';
import { parseWeather, weatherUrl, type Weather } from '../lib/weather';

const CACHE_MS = 30 * 60 * 1000;
const CACHE_KM = 3;

/**
 * Snow and weather for a spot, cached for 30 minutes (and within 3 km) so
 * opening the app on the mountain doesn't refetch every time.
 */
export async function getWeather(lat: number, lon: number, alt: number | null, force = false): Promise<Weather | null> {
  if (!force) {
    try {
      const c = JSON.parse((await kvGet('weather')) ?? 'null') as { lat: number; lon: number; data: Weather } | null;
      if (c && Date.now() - c.data.fetchedAt < CACHE_MS && distance(c, { lat, lon }) < CACHE_KM * 1000) return c.data;
    } catch {
      // ignore a bad cache entry
    }
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(weatherUrl(lat, lon, alt), { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = parseWeather(await res.json());
    await kvSet('weather', JSON.stringify({ lat, lon, data }));
    return data;
  } catch {
    return null;
  }
}
