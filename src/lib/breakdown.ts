import type { Difficulty, PisteMatch } from './pistes';
import type { Activity } from './types';

/** Order pistes are shown in, easiest first. `null` = runs we couldn't match to a piste. */
export const DIFFICULTY_ORDER: Difficulty[] = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride', null];

export interface DifficultyShare {
  difficulty: Difficulty;
  runs: number;
  time: number; // s
  vertical: number; // m
  /** Share of total ski time (0..1). */
  share: number;
}

/**
 * Time and vertical per piste difficulty, for one day or many.
 * `pistes` maps a run's start time to the piste it was on (see lib/pistes.ts).
 */
export function difficultyBreakdown(
  days: { activities: Activity[]; pistes: Record<string, PisteMatch> | null }[],
): DifficultyShare[] {
  const acc = new Map<Difficulty, { runs: number; time: number; vertical: number }>();
  let total = 0;
  for (const d of days) {
    for (const a of d.activities) {
      if (a.kind !== 'run') continue;
      const diff = d.pistes?.[String(a.startTime)]?.difficulty ?? null;
      const cur = acc.get(diff) ?? { runs: 0, time: 0, vertical: 0 };
      cur.runs++;
      cur.time += a.duration;
      cur.vertical += a.verticalDown;
      acc.set(diff, cur);
      total += a.duration;
    }
  }
  return DIFFICULTY_ORDER.filter((d) => acc.has(d)).map((d) => {
    const v = acc.get(d)!;
    return { difficulty: d, ...v, share: total > 0 ? v.time / total : 0 };
  });
}
