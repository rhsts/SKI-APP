import { weekStart } from './goals';
import type { MotionSummary } from './motion';
import type { DaySummary } from './season';

// ---------- streaks ----------

export interface Streaks {
  /** Ski days in a row up to today (or yesterday: today isn't over yet). */
  days: number;
  bestDays: number;
  /** Weeks in a row with at least one ski day, up to this week (or last week). */
  weeks: number;
  bestWeeks: number;
}

const DAY = 86400000;
const WEEK = 7 * DAY;

function midnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Longest run of consecutive values (step apart, ± an hour for DST) and the run ending at the last value. */
function runs(sorted: number[], step: number): { best: number; last: number } {
  let best = 0, cur = 0;
  for (let i = 0; i < sorted.length; i++) {
    cur = i > 0 && Math.round((sorted[i] - sorted[i - 1]) / step) === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return { best, last: cur };
}

export function computeStreaks(days: Pick<DaySummary, 'startedAt'>[], now = Date.now()): Streaks {
  const dayKeys = [...new Set(days.map((d) => midnight(d.startedAt)))].sort((a, b) => a - b);
  const weekKeys = [...new Set(days.map((d) => weekStart(d.startedAt)))].sort((a, b) => a - b);
  const d = runs(dayKeys, DAY);
  const w = runs(weekKeys, WEEK);
  const lastDay = dayKeys[dayKeys.length - 1];
  const lastWeek = weekKeys[weekKeys.length - 1];
  const today = midnight(now), thisWeek = weekStart(now);
  return {
    days: lastDay != null && Math.round((today - lastDay) / DAY) <= 1 ? d.last : 0,
    bestDays: d.best,
    weeks: lastWeek != null && Math.round((thisWeek - lastWeek) / WEEK) <= 1 ? w.last : 0,
    bestWeeks: w.best,
  };
}

// ---------- weekly challenges ----------

export type WeeklyKind = 'vertical' | 'topSpeed' | 'runs' | 'longestRun' | 'days' | 'turns' | 'airtime' | 'jumps' | 'earlyBird';

export interface WeeklyChallenge {
  kind: WeeklyKind;
  emoji: string;
  value: number;
  target: number;
  /** 0..1 */
  progress: number;
  done: boolean;
}

export const WEEKLY_EMOJI: Record<WeeklyKind, string> = {
  vertical: '⛰️', topSpeed: '💨', runs: '🔁', longestRun: '📏', days: '📅', turns: '🌀', airtime: '🦘', jumps: '🛫', earlyBird: '🌅',
};

/** Challenges per week. */
export const WEEKLY_COUNT = 3;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);
const hour = (ms: number) => new Date(ms).getHours() + new Date(ms).getMinutes() / 60;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * This week's three challenges. They change every Monday and are the same all
 * week; targets are set from your own earlier days, so they're always within
 * reach but never free.
 */
export function weeklyChallenges(
  days: DaySummary[],
  motion: Record<string, MotionSummary> = {},
  now = Date.now(),
): WeeklyChallenge[] {
  const wk = weekStart(now);
  const before = days.filter((d) => d.startedAt < wk);
  const week = days.filter((d) => d.startedAt >= wk && d.startedAt < wk + WEEK);
  const usesMotion = days.some((d) => (motion[d.id]?.jumps ?? 0) > 0);
  const hasTurns = days.some((d) => d.stats.turns != null);

  const runsOf = (d: DaySummary) => d.stats.activities.filter((a) => a.kind === 'run');
  const sum = (xs: DaySummary[], f: (d: DaySummary) => number) => xs.reduce((s, d) => s + f(d), 0);
  const max = (xs: DaySummary[], f: (d: DaySummary) => number) => xs.reduce((m, d) => Math.max(m, f(d)), 0);

  type Def = { kind: WeeklyKind; target: () => number; value: () => number };
  const bestTop = max(before, (d) => d.stats.topSpeed);
  const longest = max(before, (d) => d.stats.longestRun);
  const pool: Def[] = [
    { kind: 'vertical', target: () => roundTo(Math.max(3000, 2 * median(before.map((d) => d.stats.verticalDown))), 500), value: () => sum(week, (d) => d.stats.verticalDown) },
    { kind: 'topSpeed', target: () => (bestTop > 0 ? bestTop + 1 / 3.6 : 50 / 3.6), value: () => max(week, (d) => d.stats.topSpeed) },
    { kind: 'runs', target: () => roundTo(Math.max(10, 2 * median(before.map((d) => d.stats.runCount))), 5), value: () => sum(week, (d) => d.stats.runCount) },
    { kind: 'longestRun', target: () => (longest > 0 ? Math.ceil(longest / 100) * 100 : 2000), value: () => max(week, (d) => d.stats.longestRun) },
    { kind: 'days', target: () => (before.length >= 10 ? 3 : 2), value: () => new Set(week.map((d) => new Date(d.startedAt).toDateString())).size },
    { kind: 'earlyBird', target: () => 1, value: () => week.filter((d) => runsOf(d).some((r) => hour(r.startTime) < 9)).length },
  ];
  if (hasTurns) {
    const typical = median(before.filter((d) => d.stats.turns != null).map((d) => d.stats.turns!));
    pool.push({ kind: 'turns', target: () => roundTo(Math.max(150, 2 * typical), 50), value: () => sum(week, (d) => d.stats.turns ?? 0) });
  }
  if (usesMotion) {
    const typical = median(before.map((d) => motion[d.id]?.totalAir ?? 0).filter((v) => v > 0));
    pool.push({ kind: 'airtime', target: () => Math.max(3, Math.round(1.5 * typical)), value: () => sum(week, (d) => motion[d.id]?.totalAir ?? 0) });
    pool.push({ kind: 'jumps', target: () => roundTo(Math.max(5, 2 * median(before.map((d) => motion[d.id]?.jumps ?? 0).filter((v) => v > 0))), 5), value: () => sum(week, (d) => motion[d.id]?.jumps ?? 0) });
  }

  // Same three all week: shuffle with the week number as seed.
  const rnd = mulberry32(Math.round(wk / WEEK));
  const order = pool.map((d) => ({ d, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.d);
  return order.slice(0, WEEKLY_COUNT).map(({ kind, target, value }) => {
    const t = target(), v = value();
    return { kind, emoji: WEEKLY_EMOJI[kind], value: v, target: t, progress: t > 0 ? Math.min(1, v / t) : 0, done: v >= t };
  });
}

/** Weeks in which you completed all three challenges, oldest first, as their Monday. */
export function heroWeeks(days: DaySummary[], motion: Record<string, MotionSummary> = {}): number[] {
  const weeks = [...new Set(days.map((d) => weekStart(d.startedAt)))].sort((a, b) => a - b);
  return weeks.filter((w) => {
    const upTo = days.filter((d) => d.startedAt < w + WEEK);
    return weeklyChallenges(upTo, motion, w + 3 * DAY).every((c) => c.done);
  });
}
