import { computeBadges, DEFAULT_GOALS, goalProgress, weekStart } from '../src/lib/goals';
import type { DaySummary } from '../src/lib/season';
import type { Attempt } from '../src/lib/segments';
import { simulateDay } from '../src/lib/sim';
import { computeStats } from '../src/lib/stats';

const mkDay = (id: string, date: Date, opts: Parameters<typeof simulateDay>[0] = {}, place = 'Lech'): DaySummary => {
  const sim = simulateDay({ start: date.getTime(), ...opts });
  return { id, startedAt: date.getTime(), place, stats: computeStats(sim.points) };
};

describe('goals', () => {
  it('weeks start on Monday', () => {
    const wed = new Date(2026, 0, 14, 15).getTime(); // Wednesday
    expect(new Date(weekStart(wed))).toEqual(new Date(2026, 0, 12, 0, 0, 0, 0));
    const sun = new Date(2026, 0, 18, 10).getTime();
    expect(new Date(weekStart(sun))).toEqual(new Date(2026, 0, 12));
  });

  it('tracks weekly vertical, season top speed and ski days', () => {
    const now = new Date(2026, 0, 16, 18).getTime(); // Friday evening
    const days = [
      mkDay('mon', new Date(2026, 0, 12, 9)), // this week
      mkDay('thu', new Date(2026, 0, 15, 9), { runTopSpeeds: [25] , runs: 1 }), // this week, 90 km/h
      mkDay('last-week', new Date(2026, 0, 5, 9)),
      mkDay('last-season', new Date(2025, 2, 1, 9), { runTopSpeeds: [30], runs: 1 }),
    ];
    const [vert, speed, count] = goalProgress(days, DEFAULT_GOALS, now);
    expect(vert.value).toBeCloseTo(days[0].stats.verticalDown + days[1].stats.verticalDown);
    expect(vert.done).toBe(false);
    expect(speed.value).toBeCloseTo(days[1].stats.topSpeed); // last season's 108 km/h doesn't count
    expect(speed.done).toBe(true);
    expect(speed.progress).toBe(1);
    expect(count.value).toBe(3);
  });
});

describe('badges', () => {
  const days = [
    mkDay('d1', new Date(2026, 0, 10, 8, 30), { runs: 2, runTopSpeeds: [14, 15] }, 'Lech'),
    mkDay('d2', new Date(2026, 0, 11, 13), { runs: 4, runTopSpeeds: [18, 23, 20, 19] }, 'Zürs'),
    mkDay('d3', new Date(2026, 0, 12, 15, 40), { runs: 2 }, 'Ischgl'),
  ];
  const att = (player: string, seg: string, time: number, at: number, session: string | null = null): Attempt =>
    ({ id: `${player}:${at}`, segmentId: seg, sessionId: session, playerId: player, playerName: player, time, at, ghost: null });

  const badges = computeBadges(days, [att('me', 's1', 80, 5, 'd2'), att('sam', 's1', 85, 6)], 'me');
  const get = (id: string) => badges.find((b) => b.id === id)!;

  it('awards each badge to the first day that earned it', () => {
    expect(get('first-tracks').dayId).toBe('d1');
    expect(get('early-bird').dayId).toBe('d1'); // first run before 9:00
    expect(get('speed-60').dayId).toBe('d2'); // 23 m/s ≈ 83 km/h
    expect(get('speed-80').dayId).toBe('d2');
    expect(get('speed-100').dayId).toBeNull();
    expect(get('explorer').dayId).toBe('d3'); // third place
    expect(get('last-chair').dayId).toBe('d3'); // afternoon day ends after 16:00
  });

  it('counts challenge badges', () => {
    expect(get('challenger').dayId).toBe('d2');
    expect(get('champion').earnedAt).toBe(5);
    const losing = computeBadges(days, [att('me', 's1', 90, 5), att('sam', 's1', 85, 6)], 'me');
    expect(losing.find((b) => b.id === 'champion')!.earnedAt).toBeNull();
  });

  it('has nothing earned with no days', () => {
    expect(computeBadges([], [], 'me').every((b) => b.earnedAt == null)).toBe(true);
  });
});

describe('badge details', () => {
  it('every badge has a description and a tip to show when tapped', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { badgeInfo, computeBadges } = require('../src/lib/goals');
    const all = computeBadges([], [], 'me') as { id: string; icon: string; title: string }[];
    expect(all.length).toBeGreaterThan(15);
    for (const b of all) {
      const info = badgeInfo(b.id);
      expect(info?.title).toBe(b.title);
      expect(info?.description.length).toBeGreaterThan(5);
      expect(info?.tip?.length).toBeGreaterThan(10);
    }
    expect(badgeInfo('no-such-badge')).toBeNull();
  });
});
