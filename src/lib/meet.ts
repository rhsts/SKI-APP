import { fmtDist, fmtTimeOfDay } from './format';
import { bearing, distance, type LatLon } from './geo';
import type { Pin } from './groups';
import type { Units } from './types';

/** Meet-up pins: what they say, which way they are, and which ones are news. */

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Closer than this you have arrived: GPS can't tell which way a few metres is. */
const HERE_M = 30;
/** A time that passed longer ago than this means tomorrow. */
const PAST_MS = 3600 * 1000;

/** "Lunch at the top of the Gondola, 12:30" */
export function pinText(pin: Pick<Pin, 'label' | 'meetAt'>): string {
  return pin.meetAt == null ? pin.label : `${pin.label}, ${fmtTimeOfDay(pin.meetAt)}`;
}

/** "450 m north-east of you". As the crow flies: a rough way to go, not a route down the pistes. */
export function pinWay(me: LatLon, pin: LatLon, units: Units): string {
  const d = distance(me, pin);
  if (d < HERE_M) return 'You are here';
  return `${fmtDist(d, units)} ${COMPASS[Math.round(bearing(me, pin) / 45) % 8]} of you`;
}

/**
 * The time someone typed ("12:30", "12.30", "1230", "12") as that time today, in ms.
 * A time more than an hour ago means tomorrow. Null when it isn't a time.
 */
export function parseMeetTime(text: string, now = Date.now()): number | null {
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d.getTime() < now - PAST_MS) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * The pins to tell you about: someone else's, and not announced before.
 * `seen` holds, per group, the `createdAt` of the last pin you were told about.
 */
export function unseenPins<T extends Pick<Pin, 'mine' | 'createdAt'> & { groupId: string }>(pins: T[], seen: Record<string, number>): T[] {
  return pins.filter((p) => !p.mine && seen[p.groupId] !== p.createdAt);
}
