import { listAttempts, listSessions, motionSummaries } from '../db';
import { computeBadges, type Badge } from '../lib/goals';
import { getSettings } from '../settings';

/** Badges that this day was the first to earn (to celebrate right after finishing it). */
export async function badgesEarnedBy(dayId: string): Promise<Badge[]> {
  const sessions = await listSessions();
  const days = sessions
    .filter((d) => d.stats)
    .map((d) => ({ id: d.id, startedAt: d.startedAt, place: d.place, stats: d.stats! }));
  return computeBadges(days, await listAttempts(), getSettings().playerId, await motionSummaries()).filter((b) => b.dayId === dayId);
}
