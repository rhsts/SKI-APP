import type { DayStats } from './types';

/** Minimal view of a saved day needed for season maths. */
export interface DaySummary {
  id: string;
  startedAt: number;
  place: string | null;
  stats: DayStats;
  sport?: string;
}

/** Pseudo season key for lifetime totals. */
export const ALL_TIME = 'all';

/** A ski season runs 1 July → 30 June and is named after both years, e.g. "2025/26". */
export function seasonOf(ms: number): { key: string; start: number; end: number } {
  const d = new Date(ms);
  const y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return {
    key: `${y}/${String((y + 1) % 100).padStart(2, '0')}`,
    start: new Date(y, 6, 1).getTime(),
    end: new Date(y + 1, 6, 1).getTime(),
  };
}

export interface SeasonRecord {
  value: number;
  dayId: string;
  date: number;
}

export interface SeasonSummary {
  key: string;
  days: number;
  verticalDown: number;
  distance: number;
  skiDistance: number;
  skiTime: number;
  runs: number;
  places: string[];
  liftWaitTime: number;
  tourVertical: number;
  /** Days per sport. */
  sports: Record<string, number>;
  /** Seasons covered (filled for ALL_TIME). */
  seasons: Set<string>;
  records: {
    topSpeed: SeasonRecord | null;
    longestRun: SeasonRecord | null;
    mostVertical: SeasonRecord | null;
    mostRuns: SeasonRecord | null;
    longestDay: SeasonRecord | null;
  };
}

function better(cur: SeasonRecord | null, value: number, day: DaySummary): SeasonRecord | null {
  if (value <= 0) return cur;
  if (!cur || value > cur.value) return { value, dayId: day.id, date: day.startedAt };
  return cur;
}

export function summariseSeason(key: string, days: DaySummary[]): SeasonSummary {
  const out: SeasonSummary = {
    key, days: 0, verticalDown: 0, distance: 0, skiDistance: 0, skiTime: 0, runs: 0, places: [],
    liftWaitTime: 0, tourVertical: 0, sports: {}, seasons: new Set(),
    records: { topSpeed: null, longestRun: null, mostVertical: null, mostRuns: null, longestDay: null },
  };
  // Several recordings on the same calendar day count as one ski day.
  const calendarDays = new Set<string>();
  for (const day of days) {
    if (key !== ALL_TIME && seasonOf(day.startedAt).key !== key) continue;
    const d = new Date(day.startedAt);
    calendarDays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    const s = day.stats;
    out.verticalDown += s.verticalDown;
    out.liftWaitTime += s.liftWaitTime ?? 0;
    out.tourVertical += s.tourVertical ?? 0;
    const sport = day.sport ?? 'ski';
    out.sports[sport] = (out.sports[sport] ?? 0) + 1;
    if (key === ALL_TIME) out.seasons.add(seasonOf(day.startedAt).key);
    out.distance += s.distance;
    out.skiDistance += s.skiDistance;
    out.skiTime += s.skiTime;
    out.runs += s.runCount;
    if (day.place && !out.places.includes(day.place)) out.places.push(day.place);
    out.records.topSpeed = better(out.records.topSpeed, s.topSpeed, day);
    out.records.longestRun = better(out.records.longestRun, s.longestRun, day);
    out.records.mostVertical = better(out.records.mostVertical, s.verticalDown, day);
    out.records.mostRuns = better(out.records.mostRuns, s.runCount, day);
    out.records.longestDay = better(out.records.longestDay, s.skiTime, day);
  }
  out.days = calendarDays.size;
  return out;
}

/** Season keys that have at least one day, newest first. */
export function seasonKeys(days: { startedAt: number }[]): string[] {
  const keys = new Set(days.map((d) => seasonOf(d.startedAt).key));
  return [...keys].sort().reverse();
}
