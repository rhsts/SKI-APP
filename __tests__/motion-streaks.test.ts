import { computeBadges, weekStart } from '../src/lib/goals';
import { jumpHeight, MotionDetector, summariseMotion, type AccelSample, type MotionEvent } from '../src/lib/motion';
import type { DaySummary } from '../src/lib/season';
import { simulateDay } from '../src/lib/sim';
import { computeStats } from '../src/lib/stats';
import { computeStreaks, heroWeeks, weeklyChallenges } from '../src/lib/streaks';

/** 50 Hz accelerometer trace from [duration ms, g] pieces, with a little noise on each axis. */
function trace(pieces: [number, number][], t0 = 1_000_000): AccelSample[] {
  const out: AccelSample[] = [];
  let t = t0, k = 0;
  for (const [ms, g] of pieces) {
    for (let e = 0; e < ms; e += 20) {
      const wob = 0.03 * Math.sin(k++ * 1.7);
      out.push({ t, x: wob, y: wob / 2, z: g });
      t += 20;
    }
  }
  return out;
}
const run = (samples: AccelSample[]) => {
  const d = new MotionDetector();
  return samples.flatMap((s) => d.push(s));
};
// Skiing: bumpy, between 0.7 and 1.6 g.
const skiing = (ms: number): [number, number][] => Array.from({ length: Math.round(ms / 200) }, (_, i) => [200, 1.15 + 0.45 * Math.sin(i)] as [number, number]);

describe('jumps', () => {
  it('times the airtime of a jump', () => {
    const ev = run(trace([...skiing(2000), [800, 0.08], [100, 2.8], [100, 1.8], ...skiing(2000)]));
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe('jump');
    expect(ev[0].value).toBeCloseTo(0.8, 1);
    expect(jumpHeight(0.8)).toBeCloseTo(0.78, 1);
  });

  it('ignores short bumps and free fall without a landing', () => {
    expect(run(trace([...skiing(2000), [120, 0.1], ...skiing(2000)]))).toEqual([]);
    expect(run(trace([...skiing(1000), [600, 0.1], [600, 1.0], ...skiing(1000)]))).toEqual([]);
  });

  it('a gap in the samples (app in background) resets the detector', () => {
    const a = trace([...skiing(1000), [400, 0.1]]);
    const b = trace([[100, 2.5], ...skiing(1000)], a[a.length - 1].t + 5000);
    expect(run([...a, ...b])).toEqual([]);
  });
});

describe('falls', () => {
  it('a hard impact followed by lying still is a fall', () => {
    const ev = run(trace([...skiing(3000), [60, 4.2], [300, 2.2], [700, 1.4], [4000, 1.0]]));
    expect(ev.map((e) => e.kind)).toEqual(['fall']);
    expect(ev[0].value).toBeCloseTo(4.2, 1);
  });

  it('a hard landing that you ski away from is not a fall', () => {
    const ev = run(trace([...skiing(2000), [600, 0.1], [80, 4.5], ...skiing(8000)]));
    expect(ev.map((e) => e.kind)).toEqual(['jump']);
  });

  it('standing still without an impact is not a fall', () => {
    expect(run(trace([...skiing(2000), [8000, 1.0]]))).toEqual([]);
  });

  it('counts one crash once', () => {
    const ev = run(trace([...skiing(1000), [60, 5], [4000, 1.0], [60, 3.5], [4000, 1.0]]));
    expect(ev.filter((e) => e.kind === 'fall')).toHaveLength(1);
  });
});

describe('turns from GPS', () => {
  it('counts S-turns and their force', () => {
    const st = computeStats(simulateDay({ turns: true, barometer: true }).points);
    const runs = st.activities.filter((a) => a.kind === 'run');
    // The fake piste has ~40 S-turns per run (2.5 km, one turn every 60 m).
    for (const r of runs) expect(r.turns).toBeGreaterThan(28);
    for (const r of runs) expect(r.turns).toBeLessThan(48);
    expect(st.turns).toBe(runs.reduce((s, r) => s + (r.turns ?? 0), 0));
    expect(st.maxG).toBeGreaterThan(0.3);
    expect(st.maxG).toBeLessThan(1.5);
  });

  it('a straight-ish run has only the piste’s bends', () => {
    const st = computeStats(simulateDay({ barometer: true }).points);
    for (const r of st.activities.filter((a) => a.kind === 'run')) expect(r.turns).toBeLessThan(8);
  });

  it('the demo day comes with jumps and a fall', () => {
    const sim = simulateDay({ turns: true, runs: 4 });
    const m = summariseMotion(sim.motion);
    expect(m.jumps).toBeGreaterThanOrEqual(4);
    expect(m.falls).toBe(1);
    // Adding motion doesn't change the GPS track.
    expect(simulateDay({ runs: 4 }).points).toEqual(simulateDay({ runs: 4 }).points);
  });
});

const day = (id: string, date: [number, number, number], over: Partial<DaySummary['stats']> = {}): DaySummary => {
  const startedAt = new Date(date[0], date[1], date[2], 10).getTime();
  const base = computeStats([]);
  return {
    id, startedAt, place: 'X',
    stats: { ...base, verticalDown: 3000, runCount: 10, topSpeed: 15, longestRun: 1500, turns: 200, maxG: 0.6, ...over },
  };
};

describe('streaks', () => {
  it('counts days and weeks in a row', () => {
    const days = [day('a', [2026, 0, 5]), day('b', [2026, 0, 6]), day('c', [2026, 0, 7]), day('d', [2026, 0, 20]), day('e', [2026, 0, 21])];
    const s = computeStreaks(days, new Date(2026, 0, 22, 12).getTime());
    expect(s.bestDays).toBe(3);
    expect(s.days).toBe(2); // yesterday + the day before
    expect(computeStreaks(days, new Date(2026, 0, 25).getTime()).days).toBe(0);
    expect(s.bestWeeks).toBe(1); // weeks of 5 Jan and 19 Jan, not back to back
    expect(computeStreaks([day('a', [2026, 0, 5]), day('b', [2026, 0, 14])], new Date(2026, 0, 15).getTime()).weeks).toBe(2);
    // Two recordings on one day are one ski day.
    expect(computeStreaks([day('a', [2026, 0, 5]), day('b', [2026, 0, 5])], new Date(2026, 0, 5).getTime()).bestDays).toBe(1);
  });

  it('streak badges', () => {
    const days = [day('a', [2026, 0, 5]), day('b', [2026, 0, 6]), day('c', [2026, 0, 7])];
    const b = computeBadges(days, [], 'me');
    expect(b.find((x) => x.id === 'streak-3')?.dayId).toBe('c');
    expect(b.find((x) => x.id === 'streak-5')?.dayId).toBeNull();
  });
});

describe('weekly challenges', () => {
  const now = new Date(2026, 0, 14, 12).getTime(); // a Wednesday
  const history = [day('a', [2025, 11, 20]), day('b', [2025, 11, 21], { topSpeed: 20 }), day('c', [2025, 11, 22])];

  it('three challenges, the same all week, new next week', () => {
    const w1 = weeklyChallenges(history, {}, now);
    expect(w1).toHaveLength(3);
    expect(new Set(w1.map((w) => w.kind)).size).toBe(3);
    expect(weeklyChallenges(history, {}, now + 2 * 86400000).map((w) => w.kind)).toEqual(w1.map((w) => w.kind));
    const kinds = new Set<string>();
    for (let k = 0; k < 8; k++) weeklyChallenges(history, {}, now + k * 7 * 86400000).forEach((w) => kinds.add(w.kind));
    expect(kinds.size).toBeGreaterThan(3);
  });

  it('targets come from your own days, progress from this week', () => {
    const thisWeek = [...history, day('d', [2026, 0, 12], { topSpeed: 21, verticalDown: 4000 })];
    let target: number | null = null;
    for (let k = 0; k < 30 && target == null; k++) {
      const t = now + k * 7 * 86400000;
      const ws = weeklyChallenges(thisWeek.map((d) => ({ ...d, startedAt: d.id === 'd' ? weekStart(t) + 3600000 * 10 : d.startedAt })), {}, t);
      const top = ws.find((w) => w.kind === 'topSpeed');
      if (top) {
        target = top.target;
        expect(top.value).toBe(21);
        expect(top.done).toBe(true);
      }
    }
    expect(target).toBeCloseTo(20 + 1 / 3.6, 3);
  });

  it('airtime challenges only once you have jumps', () => {
    const motion = { a: { jumps: 3, bestAir: 0.8, totalAir: 1.5, falls: 0 } };
    const all = new Set<string>();
    for (let k = 0; k < 40; k++) weeklyChallenges(history, {}, now + k * 7 * 86400000).forEach((w) => all.add(w.kind));
    expect(all.has('airtime')).toBe(false);
    const withM = new Set<string>();
    for (let k = 0; k < 40; k++) weeklyChallenges(history, motion, now + k * 7 * 86400000).forEach((w) => withM.add(w.kind));
    expect(withM.has('airtime') || withM.has('jumps')).toBe(true);
  });

  it('a week where you smash everything is a Weekly hero week', () => {
    const big = { verticalDown: 50000, runCount: 200, topSpeed: 40, longestRun: 9000, turns: 5000 };
    const t = new Date(2026, 0, 12, 7).getTime(); // Monday 07:00
    const runAt = (h: number) => ({ kind: 'run' as const, startIndex: 0, endIndex: 1, startTime: t + h * 3600000, endTime: t + h * 3600000 + 60000, duration: 60, distance: 500, verticalDown: 100, verticalUp: 0, topSpeed: 10, avgSpeed: 8 });
    const week = [0, 1, 2].map((k) => {
      const d = day(`w${k}`, [2026, 0, 12 + k], big);
      return { ...d, stats: { ...d.stats, activities: [runAt(1 + k * 24)] } };
    });
    const hero = heroWeeks([...history, ...week]);
    expect(hero).toContain(weekStart(t));
    expect(computeBadges([...history, ...week], [], 'me').find((b) => b.id === 'weekly-hero')?.dayId).toBe('w2');
  });
});

describe('motion summary', () => {
  it('adds up jumps and falls', () => {
    const ev: MotionEvent[] = [{ t: 1, kind: 'jump', value: 0.5 }, { t: 2, kind: 'jump', value: 1.1 }, { t: 3, kind: 'fall', value: 4 }];
    expect(summariseMotion(ev)).toEqual({ jumps: 2, bestAir: 1.1, totalAir: 1.6, falls: 1 });
  });
});

describe('backup', () => {
  it('keeps jumps and falls, drops junk', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseBackup } = require('../src/lib/backup');
    const b = parseBackup(JSON.stringify({
      app: 'ski-tracker', v: 1, days: [{ id: 'd1', startedAt: 1, points: [], motion: [[5, 'jump', 0.7, 47, 10], [6, 'nope', 1, 0, 0], [7, 'fall', 'x']] }],
    }));
    expect(b.days[0].motion).toEqual([[5, 'jump', 0.7, 47, 10]]);
  });
});
