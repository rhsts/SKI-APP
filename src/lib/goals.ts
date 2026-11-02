import { seasonOf, type DaySummary } from './season';
import { leaderboard, type Attempt } from './segments';

// ---------- goals ----------

export interface Goals {
  weeklyVertical: number; // m
  seasonTopSpeed: number; // m/s
  seasonDays: number;
}

export const DEFAULT_GOALS: Goals = { weeklyVertical: 10000, seasonTopSpeed: 80 / 3.6, seasonDays: 10 };

/** Monday 00:00 (local time) of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export interface GoalProgress {
  key: keyof Goals;
  value: number;
  target: number;
  /** 0..1 */
  progress: number;
  done: boolean;
}

export function goalProgress(days: DaySummary[], goals: Goals, now = Date.now()): GoalProgress[] {
  const wk = weekStart(now);
  const season = seasonOf(now);
  const inSeason = days.filter((d) => d.startedAt >= season.start && d.startedAt < season.end);
  const weekVert = days.filter((d) => d.startedAt >= wk && d.startedAt <= now).reduce((s, d) => s + d.stats.verticalDown, 0);
  const top = inSeason.reduce((m, d) => Math.max(m, d.stats.topSpeed), 0);
  const calendarDays = new Set(inSeason.map((d) => new Date(d.startedAt).toDateString())).size;
  const mk = (key: keyof Goals, value: number): GoalProgress => {
    const target = goals[key];
    return { key, value, target, progress: target > 0 ? Math.min(1, value / target) : 0, done: value >= target };
  };
  return [mk('weeklyVertical', weekVert), mk('seasonTopSpeed', top), mk('seasonDays', calendarDays)];
}

// ---------- badges ----------

export interface Badge {
  id: string;
  emoji: string;
  title: string;
  description: string;
  /** The day that earned it (null if not earned yet). */
  dayId: string | null;
  earnedAt: number | null;
}

interface BadgeDef {
  id: string;
  emoji: string;
  title: string;
  description: string;
  /** Does this single day earn it? */
  day?: (d: DaySummary) => boolean;
  /** Earned by the running totals as of this day (days are fed oldest first). */
  cumulative?: (sofar: DaySummary[]) => boolean;
}

const KMH = 1 / 3.6;
const hourOf = (ms: number) => new Date(ms).getHours() + new Date(ms).getMinutes() / 60;
const runs = (d: DaySummary) => d.stats.activities.filter((a) => a.kind === 'run');

const DEFS: BadgeDef[] = [
  { id: 'first-tracks', emoji: '🎿', title: 'First tracks', description: 'Record your first ski day.', day: () => true },
  { id: 'speed-60', emoji: '💨', title: 'Fast lane', description: 'Hit 60 km/h.', day: (d) => d.stats.topSpeed >= 60 * KMH },
  { id: 'speed-80', emoji: '🚀', title: 'Speed demon', description: 'Hit 80 km/h.', day: (d) => d.stats.topSpeed >= 80 * KMH },
  { id: 'speed-100', emoji: '⚡', title: 'Ton up', description: 'Hit 100 km/h.', day: (d) => d.stats.topSpeed >= 100 * KMH },
  { id: 'vert-5k', emoji: '⛰️', title: 'Big day', description: 'Ski 5,000 m of vertical in one day.', day: (d) => d.stats.verticalDown >= 5000 },
  { id: 'vert-10k', emoji: '🏔️', title: 'Leg burner', description: 'Ski 10,000 m of vertical in one day.', day: (d) => d.stats.verticalDown >= 10000 },
  { id: 'runs-20', emoji: '🔁', title: 'Lap machine', description: 'Ski 20 runs in one day.', day: (d) => d.stats.runCount >= 20 },
  { id: 'early-bird', emoji: '🌅', title: 'Early bird', description: 'Start a run before 9:00.', day: (d) => runs(d).some((r) => hourOf(r.startTime) < 9) },
  { id: 'last-chair', emoji: '🌇', title: 'Last chair', description: 'Finish a run after 16:00.', day: (d) => runs(d).some((r) => hourOf(r.endTime) >= 16) },
  { id: 'days-10', emoji: '📅', title: 'Ten days', description: 'Ski 10 days in one season.',
    cumulative: (sofar) => {
      const key = seasonOf(sofar[sofar.length - 1].startedAt).key;
      return new Set(sofar.filter((d) => seasonOf(d.startedAt).key === key).map((d) => new Date(d.startedAt).toDateString())).size >= 10;
    } },
  { id: 'season-50k', emoji: '🗻', title: 'Everest ×5', description: 'Ski 50,000 m of vertical in one season.',
    cumulative: (sofar) => {
      const key = seasonOf(sofar[sofar.length - 1].startedAt).key;
      return sofar.filter((d) => seasonOf(d.startedAt).key === key).reduce((s, d) => s + d.stats.verticalDown, 0) >= 50000;
    } },
  { id: 'explorer', emoji: '🧭', title: 'Explorer', description: 'Ski at 3 different places.',
    cumulative: (sofar) => new Set(sofar.map((d) => d.place).filter(Boolean)).size >= 3 },
];

const CHALLENGE_BADGES = [
  { id: 'challenger', emoji: '🏁', title: 'Challenger', description: 'Set a time on a challenge.' },
  { id: 'champion', emoji: '🏆', title: 'Champion', description: 'Lead a challenge with at least 2 skiers.' },
];

/**
 * All badges, each with the day that earned it (or null). Days are scanned
 * oldest first, so a badge belongs to the first day that qualified.
 */
export function computeBadges(days: DaySummary[], attempts: Attempt[], playerId: string): Badge[] {
  const sorted = days.slice().sort((a, b) => a.startedAt - b.startedAt);
  const earned = new Map<string, { dayId: string | null; at: number }>();
  const sofar: DaySummary[] = [];
  for (const d of sorted) {
    sofar.push(d);
    for (const def of DEFS) {
      if (earned.has(def.id)) continue;
      if ((def.day && def.day(d)) || (def.cumulative && def.cumulative(sofar))) earned.set(def.id, { dayId: d.id, at: d.startedAt });
    }
  }

  const mine = attempts.filter((a) => a.playerId === playerId).sort((a, b) => a.at - b.at);
  if (mine.length) earned.set('challenger', { dayId: mine[0].sessionId, at: mine[0].at });
  const bySeg = new Map<string, Attempt[]>();
  for (const a of attempts) bySeg.set(a.segmentId, [...(bySeg.get(a.segmentId) ?? []), a]);
  for (const list of bySeg.values()) {
    const board = leaderboard(list);
    if (board.length >= 2 && board[0].playerId === playerId) {
      const cur = earned.get('champion');
      if (!cur || board[0].at < cur.at) earned.set('champion', { dayId: board[0].sessionId, at: board[0].at });
    }
  }

  return [...DEFS, ...CHALLENGE_BADGES].map((def) => {
    const e = earned.get(def.id);
    return { id: def.id, emoji: def.emoji, title: def.title, description: def.description, dayId: e?.dayId ?? null, earnedAt: e?.at ?? null };
  });
}
