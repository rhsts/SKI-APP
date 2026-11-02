import { fmtAlt, fmtClock, fmtDist, fmtDuration, fmtSpeed } from '../src/lib/format';
import { seasonKeys, seasonOf, summariseSeason, type DaySummary } from '../src/lib/season';
import { computeStats } from '../src/lib/stats';
import { simulateDay } from '../src/lib/sim';

describe('seasonOf', () => {
  it('puts December and March in the same season', () => {
    expect(seasonOf(new Date(2025, 11, 20).getTime()).key).toBe('2025/26');
    expect(seasonOf(new Date(2026, 2, 3).getTime()).key).toBe('2025/26');
    expect(seasonOf(new Date(2026, 6, 1).getTime()).key).toBe('2026/27');
  });
});

describe('summariseSeason', () => {
  const mk = (id: string, date: Date, tops: number[], runs: number): DaySummary => {
    const sim = simulateDay({ start: date.getTime(), runTopSpeeds: tops, runs, seed: id.length });
    return { id, startedAt: date.getTime(), place: id === 'c' ? 'Lech' : 'Ischgl', stats: computeStats(sim.points) };
  };
  const days = [
    mk('a', new Date(2026, 0, 10, 9), [12, 13], 2),
    mk('b', new Date(2026, 1, 2, 9), [15, 22], 3),
    mk('c', new Date(2026, 1, 2, 14), [10], 1), // same calendar day as b
    mk('old', new Date(2025, 2, 1, 9), [30], 1), // previous season
  ];
  const s = summariseSeason('2025/26', days);

  it('counts calendar days and totals', () => {
    expect(s.days).toBe(2);
    expect(s.runs).toBe(6);
    expect(s.verticalDown).toBeCloseTo(days.slice(0, 3).reduce((v, d) => v + d.stats.verticalDown, 0));
    expect(s.places).toEqual(['Ischgl', 'Lech']);
  });

  it('finds personal records and links them to their day', () => {
    expect(s.records.topSpeed?.dayId).toBe('b');
    expect(s.records.mostRuns).toMatchObject({ dayId: 'b', value: 3 });
    expect(s.records.mostVertical?.dayId).toBe('b');
  });

  it('lists seasons newest first', () => {
    expect(seasonKeys(days)).toEqual(['2025/26', '2024/25']);
  });
});

describe('format', () => {
  it('formats metric and imperial', () => {
    expect(fmtSpeed(20, 'metric')).toBe('72.0 km/h');
    expect(fmtSpeed(20, 'imperial')).toBe('44.7 mph');
    expect(fmtAlt(1234.4, 'metric')).toBe('1,234 m');
    expect(fmtAlt(1000, 'imperial')).toBe('3,281 ft');
    expect(fmtDist(850, 'metric')).toBe('850 m');
    expect(fmtDist(12345, 'metric')).toBe('12.3 km');
    expect(fmtDuration(3900)).toBe('1h 05m');
    expect(fmtDuration(95)).toBe('1m 35s');
    expect(fmtClock(3723)).toBe('1:02:03');
    expect(fmtClock(83)).toBe('1:23');
  });
});
