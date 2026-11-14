import type { PlayerTotals } from '../friends/api';
import type { IconName } from './types';

/** One friend with the totals the friends server shares (season or all time). */
export interface FriendTotals {
  id: string;
  name: string;
  hasAvatar: boolean;
  totals: PlayerTotals;
}

export type StatKind = 'alt' | 'speed' | 'dist' | 'count' | 'hours' | 'everest';

export interface Category {
  id: string;
  icon: IconName;
  title: string;
  blurb: string;
  kind: StatKind;
  value: (t: PlayerTotals) => number;
}

/** Height of Mount Everest, for "how many Everests have you skied". */
export const EVEREST_M = 8849;

export const CATEGORIES: Category[] = [
  { id: 'vertical', icon: 'trending-down-outline', title: 'Vert Monster', blurb: 'Most vertical skied', kind: 'alt', value: (t) => t.vertical },
  { id: 'everest', icon: 'triangle-outline', title: 'Everest Collector', blurb: 'Everests skied down', kind: 'everest', value: (t) => t.vertical / EVEREST_M },
  { id: 'speed', icon: 'flash-outline', title: 'Speed Demon', blurb: 'Fastest top speed', kind: 'speed', value: (t) => t.topSpeed },
  { id: 'days', icon: 'calendar-outline', title: 'Mountain Rat', blurb: 'Most days on the hill', kind: 'count', value: (t) => t.days },
  { id: 'runs', icon: 'repeat-outline', title: 'Lap Machine', blurb: 'Most runs', kind: 'count', value: (t) => t.runs },
  { id: 'grinder', icon: 'barbell-outline', title: 'The Grinder', blurb: 'Most vertical per day', kind: 'alt', value: (t) => (t.days ? t.vertical / t.days : 0) },
  { id: 'cruiser', icon: 'resize-outline', title: 'Long Hauler', blurb: 'Longest average run', kind: 'dist', value: (t) => (t.runs ? t.distance / t.runs : 0) },
  { id: 'time', icon: 'time-outline', title: 'Never Goes Home', blurb: 'Most time skiing', kind: 'hours', value: (t) => t.skiTime },
];

export interface Ranked {
  friend: FriendTotals;
  value: number;
  /** 1 = best; ties share a rank. */
  rank: number;
}

/** Friends ranked on one category, best first. Friends with nothing to show (0) are left out. */
export function rank(friends: FriendTotals[], cat: Category): Ranked[] {
  const rows = friends
    .map((friend) => ({ friend, value: cat.value(friend.totals) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value || a.friend.name.localeCompare(b.friend.name));
  let r = 0;
  return rows.map((row, i) => {
    if (i === 0 || row.value !== rows[i - 1].value) r = i + 1;
    return { ...row, rank: r };
  });
}

/** How many categories `id` leads (rank 1, ties count). */
export function crowns(friends: FriendTotals[], id: string): number {
  return CATEGORIES.filter((c) => rank(friends, c).some((r) => r.rank === 1 && r.friend.id === id)).length;
}
