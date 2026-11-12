import { CATEGORIES, crowns, rank, type FriendTotals } from '../src/lib/leaderboard';

const f = (id: string, t: Partial<FriendTotals['totals']>): FriendTotals => ({
  id, name: id, hasAvatar: false,
  totals: { days: 0, vertical: 0, topSpeed: 0, runs: 0, distance: 0, skiTime: 0, ...t },
});

const cat = (id: string) => CATEGORIES.find((c) => c.id === id)!;

test('ranks best first, ties share a rank, zeros left out', () => {
  const friends = [f('a', { vertical: 5000 }), f('b', { vertical: 9000 }), f('c', { vertical: 5000 }), f('d', {})];
  expect(rank(friends, cat('vertical')).map((r) => [r.friend.id, r.rank])).toEqual([['b', 1], ['a', 2], ['c', 2]]);
});

test('per-day and per-run stats skip division by zero', () => {
  const friends = [f('a', { vertical: 3000, days: 3 }), f('b', { vertical: 3000, days: 0 }), f('c', { runs: 0, distance: 100 })];
  expect(rank(friends, cat('grinder')).map((r) => r.value)).toEqual([1000]);
  expect(rank(friends, cat('cruiser'))).toEqual([]);
});

test('crowns counts categories led, ties included', () => {
  const friends = [f('me', { topSpeed: 20, days: 4 }), f('pal', { topSpeed: 20, days: 2, vertical: 100 })];
  expect(crowns(friends, 'me')).toBe(2); // speed (tie) + days
  expect(crowns(friends, 'pal')).toBe(4); // speed, vertical, everest, grinder
});
