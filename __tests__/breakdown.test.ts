import { difficultyBreakdown } from '../src/lib/breakdown';
import { ALL_TIME, summariseSeason, type DaySummary } from '../src/lib/season';
import { simulateDay } from '../src/lib/sim';
import { isSport, sportInfo } from '../src/lib/sport';
import { computeStats } from '../src/lib/stats';

const stats = computeStats(simulateDay().points);
const runs = stats.activities.filter((a) => a.kind === 'run');

describe('difficulty breakdown', () => {
  it('adds up time and vertical per difficulty, easiest first, unknown last', () => {
    const pistes = {
      [String(runs[0].startTime)]: { name: 'Black', difficulty: 'advanced' as const, coverage: 1 },
      [String(runs[1].startTime)]: { name: 'Blue', difficulty: 'easy' as const, coverage: 1 },
      [String(runs[2].startTime)]: { name: 'Black', difficulty: 'advanced' as const, coverage: 1 },
    };
    const b = difficultyBreakdown([{ activities: stats.activities, pistes }]);
    expect(b.map((x) => x.difficulty)).toEqual(['easy', 'advanced', null]);
    expect(b.map((x) => x.runs)).toEqual([1, 2, 1]);
    expect(b.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
    expect(b[1].time).toBeCloseTo(runs[0].duration + runs[2].duration);
  });

  it('works across several days and with no piste data', () => {
    const b = difficultyBreakdown([{ activities: stats.activities, pistes: null }, { activities: stats.activities, pistes: {} }]);
    expect(b).toHaveLength(1);
    expect(b[0].runs).toBe(8);
  });
});

describe('all-time totals', () => {
  const day = (id: string, date: Date, sport: string): DaySummary => ({ id, startedAt: date.getTime(), place: id, stats, sport });
  const days = [day('a', new Date(2024, 0, 5), 'ski'), day('b', new Date(2025, 1, 5), 'snowboard'), day('c', new Date(2026, 0, 5), 'ski')];

  it('sums every season and counts sports', () => {
    const all = summariseSeason(ALL_TIME, days);
    expect(all.days).toBe(3);
    expect(all.seasons.size).toBe(3);
    expect(all.sports).toEqual({ ski: 2, snowboard: 1 });
    expect(all.verticalDown).toBeCloseTo(3 * stats.verticalDown);
    expect(all.liftWaitTime).toBeCloseTo(3 * (stats.liftWaitTime ?? 0));
    expect(summariseSeason('2025/26', days).days).toBe(1);
  });

  it('knows the sports', () => {
    expect(isSport('snowboard')).toBe(true);
    expect(isSport('curling')).toBe(false);
    expect(sportInfo('nope').id).toBe('ski');
  });
});
