/**
 * Finding a ski resort or town by name, with Open-Meteo's geocoding (free, no API key,
 * the same service the weather comes from; place names are from GeoNames).
 */

export interface Place {
  /** "Mürren" */
  name: string;
  /** "Bern, Switzerland" */
  region: string;
  lat: number;
  lon: number;
  /** Metres above sea level, when known. */
  alt: number | null;
}

export function geocodeUrl(name: string): string {
  const p = new URLSearchParams({ name: name.trim(), count: '8', language: 'en', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${p.toString()}`;
}

/** The service needs at least two letters; fewer returns nothing. */
export function canSearch(name: string): boolean {
  return name.trim().length >= 2;
}

/** Reads the answer. Anything that isn't a named spot with coordinates is dropped, and so are look-alikes. */
export function parsePlaces(json: unknown): Place[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const r of results as Record<string, unknown>[]) {
    if (typeof r?.name !== 'string' || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue;
    const region = [r.admin1, r.country].filter((x): x is string => typeof x === 'string' && x !== r.name).join(', ');
    // A village and its municipality often come back as two entries that read the same: keep the first.
    if (seen.has(`${r.name}|${region}`)) continue;
    seen.add(`${r.name}|${region}`);
    out.push({
      name: r.name,
      region,
      lat: r.latitude,
      lon: r.longitude,
      alt: typeof r.elevation === 'number' && Number.isFinite(r.elevation) ? r.elevation : null,
    });
  }
  return out;
}
