import { fmtAlt, fmtSpeed, fmtTimeOfDay } from './format';
import type { DayStats, Units } from './types';

/**
 * Text of the Android tracking notification: the day being recorded, on the lock screen.
 * - title, a one-line summary: "5 runs · 2,450 m ↓" ("Paused · …" when paused)
 * - body: "Run 5 top 62.3 km/h · 2h 14m since 09:12". The speed is the top speed of the run
 *   you're on, or of the last one. The start time stays right while you stand still and no
 *   GPS fix comes in to refresh the rest.
 */
export function lockScreenText(
  stats: DayStats | null,
  o: { startedAt: number; paused: boolean; units: Units; now: number },
): { title: string; body: string } {
  const runs = stats?.runCount ?? 0;
  const lastRun = stats?.activities.filter((a) => a.kind === 'run').pop();
  const mins = Math.max(0, Math.floor((o.now - o.startedAt) / 60000));
  const elapsed = mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins} min`;
  const time = `${elapsed} since ${fmtTimeOfDay(o.startedAt)}`;
  return {
    title: `${o.paused ? 'Paused · ' : ''}${runs} ${runs === 1 ? 'run' : 'runs'} · ${fmtAlt(stats?.verticalDown ?? 0, o.units)} ↓`,
    body: lastRun ? `Run ${runs} top ${fmtSpeed(lastRun.topSpeed, o.units)} · ${time}` : `${o.paused ? '' : 'Recording '}${time}`,
  };
}
