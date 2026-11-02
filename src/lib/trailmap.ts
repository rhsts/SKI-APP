import { distance, simplify, type LatLon } from './geo';
import { parseLifts, parseOverpass, type Lift, type Piste } from './pistes';

/**
 * An offline trail map: the pistes and lifts of an area from OpenStreetMap,
 * saved on the phone so they can be drawn without signal on the mountain.
 */
export interface TrailMap {
  id: string;
  /** [south, west, north, east] */
  bbox: [number, number, number, number];
  fetchedAt: number;
  pistes: Piste[];
  lifts: Lift[];
}

/** A box about `km` kilometres in each direction around a point. */
export function bboxAround(lat: number, lon: number, km = 6): [number, number, number, number] {
  const dLat = km / 111.2;
  const dLon = km / (111.2 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

export function covers(map: Pick<TrailMap, 'bbox'>, p: LatLon): boolean {
  const [s, w, n, e] = map.bbox;
  return p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e;
}

/** Thin geometry to ~4 m: plenty for drawing, and keeps the saved map small. */
function thin(coords: LatLon[]): LatLon[] {
  const keep = simplify(coords, 4);
  return keep.map((i) => ({ lat: Math.round(coords[i].lat * 1e6) / 1e6, lon: Math.round(coords[i].lon * 1e6) / 1e6 }));
}

export function buildTrailMap(json: unknown, bbox: TrailMap['bbox'], id: string, now = Date.now()): TrailMap {
  return {
    id,
    bbox,
    fetchedAt: now,
    pistes: parseOverpass(json).map((p) => ({ ...p, coords: thin(p.coords) })),
    lifts: parseLifts(json).map((l) => ({ ...l, coords: thin(l.coords) })),
  };
}

/** The saved map that covers a point (newest first), if any. */
export function mapFor(maps: TrailMap[], p: LatLon): TrailMap | null {
  return maps.filter((m) => covers(m, p)).sort((a, b) => b.fetchedAt - a.fetchedAt)[0] ?? null;
}

/** The closest named piste or lift within `maxM` metres, e.g. for telling rescuers where you are. */
export function nearestFeature(map: TrailMap, p: LatLon, maxM = 200): { kind: 'piste' | 'lift'; name: string; meters: number } | null {
  let best: { kind: 'piste' | 'lift'; name: string; meters: number } | null = null;
  const consider = (kind: 'piste' | 'lift', name: string | null, coords: LatLon[]) => {
    if (!name) return;
    for (const c of coords) {
      const d = distance(c, p);
      if (d <= maxM && (!best || d < best.meters)) best = { kind, name, meters: Math.round(d) };
    }
  };
  map.pistes.forEach((x) => consider('piste', x.name, densify(x.coords)));
  map.lifts.forEach((x) => consider('lift', x.name, densify(x.coords)));
  return best;
}

/** Adds points every ~25 m so distance-to-vertex is close to distance-to-line. */
function densify(coords: LatLon[]): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const n = Math.max(1, Math.ceil(distance(a, b) / 25));
    for (let k = 0; k < n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
  }
  if (coords.length) out.push(coords[coords.length - 1]);
  return out;
}
