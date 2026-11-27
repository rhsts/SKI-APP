import { fmtDist } from './format';
import { distance, type LatLon } from './geo';
import type { LiveMember } from './groups';
import type { Units } from './types';

/** The Friends tab's map: what to say about each friend, and where to point the camera. */

/** "Just now", "4 min ago". The server only returns people seen in the last ten minutes. */
export function seenAgo(at: number, now = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  return min < 1 ? 'Just now' : `${min} min ago`;
}

/** One line under a friend's name: "Just now · 1.2 km away". */
export function friendLine(f: LiveMember, me: LatLon | null, units: Units, now = Date.now()): string {
  const parts = [seenAgo(f.at, now)];
  if (me) parts.push(`${fmtDist(distance(me, f), units)} away`);
  return parts.join(' · ');
}

/** Closest first when we know where you are, else most recently seen first, then by name. */
export function sortFriends(friends: LiveMember[], me: LatLon | null): LiveMember[] {
  return [...friends].sort((a, b) =>
    (me ? distance(me, a) - distance(me, b) : b.at - a.at) || a.name.localeCompare(b.name));
}

/** "3 friends on the mountain" */
export function friendsHeadline(count: number): string {
  if (!count) return 'No friends out right now';
  return `${count} ${count === 1 ? 'friend' : 'friends'} on the mountain`;
}

export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/** Roughly one ski area across. */
const MIN_DELTA = 0.02;
/** Most of the Alps: where the map opens when nobody's position is known. */
export const FALLBACK_REGION: Region = { latitude: 46.6, longitude: 10.5, latitudeDelta: 6, longitudeDelta: 6 };

/** A region that shows every spot with a margin, never tighter than a ski area. */
export function regionFor(spots: LatLon[]): Region {
  if (!spots.length) return FALLBACK_REGION;
  let [minLat, maxLat, minLon, maxLon] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of spots) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(MIN_DELTA, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(MIN_DELTA, (maxLon - minLon) * 1.5),
  };
}
