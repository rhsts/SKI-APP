import { distance, type LatLon } from './geo';

export interface SkiArea {
  name: string;
  lat: number;
  lon: number;
  days: number;
}

const SAME_AREA_M = 5000;

/** Places you've skied, merged when they're within 5 km of each other. Most-visited first. */
export function skiAreas(starts: { place: string | null; lat: number; lon: number }[]): SkiArea[] {
  const areas: SkiArea[] = [];
  for (const s of starts) {
    const a = areas.find((x) => distance(x, s) < SAME_AREA_M);
    if (a) {
      a.lat = (a.lat * a.days + s.lat) / (a.days + 1);
      a.lon = (a.lon * a.days + s.lon) / (a.days + 1);
      a.days++;
      if (a.name === 'Ski area' && s.place) a.name = s.place.split(',')[0];
    } else {
      areas.push({ name: s.place?.split(',')[0] ?? 'Ski area', lat: s.lat, lon: s.lon, days: 1 });
    }
  }
  return areas.sort((x, y) => y.days - x.days);
}

/** The known ski area you're in (within `radiusM`), if any. */
export function areaAt(areas: SkiArea[], p: LatLon, radiusM = 3000): SkiArea | null {
  let best: SkiArea | null = null, bestD = Infinity;
  for (const a of areas) {
    const d = distance(a, p);
    if (d <= radiusM && d < bestD) { best = a; bestD = d; }
  }
  return best;
}
