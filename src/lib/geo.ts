const EARTH_RADIUS = 6371008.8; // m, mean radius
const RAD = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in metres (haversine). */
export function distance(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Equirectangular projection to local metres around `origin`.
 * Accurate to well under 1% over a ski area (a few km).
 */
export function localProjector(origin: LatLon) {
  const ky = RAD * EARTH_RADIUS;
  const kx = Math.cos(origin.lat * RAD) * ky;
  return {
    toXY: (p: LatLon) => ({ x: (p.lon - origin.lon) * kx, y: (p.lat - origin.lat) * ky }),
    fromXY: (x: number, y: number): LatLon => ({ lat: origin.lat + y / ky, lon: origin.lon + x / kx }),
  };
}

/** Moves `meters` from `p` along compass `bearingDeg` (flat-earth, fine for short hops). */
export function offset(p: LatLon, bearingDeg: number, meters: number): LatLon {
  const { fromXY } = localProjector(p);
  const b = bearingDeg * RAD;
  return fromXY(Math.sin(b) * meters, Math.cos(b) * meters);
}

/**
 * Douglas-Peucker simplification. Returns the indices of the points to keep
 * (always includes the first and last).
 */
export function simplify(points: LatLon[], toleranceM: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const { toXY } = localProjector(points[0]);
  const xy = points.map(toXY);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = xy[a].x, ay = xy[a].y;
    const dx = xy[b].x - ax, dy = xy[b].y - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      let t = len2 > 0 ? ((xy[i].x - ax) * dx + (xy[i].y - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - xy[i].x, ey = ay + t * dy - xy[i].y;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol2) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}
