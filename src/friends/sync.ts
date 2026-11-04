import { matchSession } from '../challenges/service';
import { getDb, getSegment, kvGet, kvSet, listAttempts, listSessions, saveSegment } from '../db';
import { dayUpload, localDate, type Group, type GroupChallenge } from '../lib/groups';
import { getSettings } from '../settings';
import { api, friendsEnabled } from './api';

/**
 * Keeps your phone and the friends server in step:
 * - your day totals go up (so group leaderboards fill in by themselves),
 * - group challenges come down and become normal challenges on your phone
 *   (so they're timed live while you ski),
 * - your times on a group challenge's day go up.
 * Everything is best-effort: no signal on the mountain just means "next time".
 */

export interface CachedChallenge {
  groupId: string;
  groupName: string;
  challengeId: string;
  segmentId: string;
  date: string;
  name: string;
}

const DAYS_BACK = 400 * 86400000;
let running: Promise<void> | null = null;
let onNewSegments: (() => Promise<void>) | null = null;

/** The tracker registers this so newly downloaded group challenges get timed right away. */
export function setNewSegmentsHandler(fn: () => Promise<void>) {
  onNewSegments = fn;
}

export async function cachedGroups(): Promise<Group[]> {
  try {
    return JSON.parse((await kvGet('friends:groups')) ?? '[]');
  } catch {
    return [];
  }
}

export async function cachedChallenges(): Promise<CachedChallenge[]> {
  try {
    return JSON.parse((await kvGet('friends:challenges')) ?? '[]');
  } catch {
    return [];
  }
}

/** Runs one sync; calls made while one is running share it. */
export function syncFriends(): Promise<void> {
  if (!friendsEnabled()) return Promise.resolve();
  running ??= doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  await api.hello();
  const groups = await api.groups();
  await kvSet('friends:groups', JSON.stringify(groups));
  if (!groups.length) {
    await kvSet('friends:challenges', '[]');
    return;
  }
  await uploadDays();
  const challenges = await pullChallenges(groups);
  await uploadAttempts(challenges);
}

async function uploadDays() {
  const { shareDemoDays } = getSettings();
  const since = Date.now() - DAYS_BACK;
  for (const s of await listSessions()) {
    if (!s.stats || s.startedAt < since) continue;
    const key = `friends:day:${s.id}`;
    if (s.isDemo && !shareDemoDays) {
      // Shared earlier for testing: take it back off the leaderboards.
      if (await kvGet(key)) {
        await api.deleteDay(s.id);
        await kvSet(key, null);
      }
      continue;
    }
    const body = dayUpload(s.startedAt, s.stats);
    const sig = JSON.stringify(body);
    if ((await kvGet(key)) === sig) continue;
    await api.putDay(s.id, body);
    await kvSet(key, sig);
  }
}

async function pullChallenges(groups: Group[]): Promise<CachedChallenge[]> {
  const out: CachedChallenge[] = [];
  const fresh: GroupChallenge[] = [];
  for (const g of groups) {
    const detail = await api.group(g.id);
    for (const c of detail.challenges) {
      out.push({ groupId: g.id, groupName: g.name, challengeId: c.id, segmentId: c.segmentId, date: c.date, name: c.segment.name });
      if (!(await getSegment(c.segmentId))) {
        await saveSegment({ ...c.segment, creatorName: c.segment.creatorName ?? c.createdByName });
        fresh.push(c);
      }
    }
  }
  await kvSet('friends:challenges', JSON.stringify(out));
  if (fresh.length) {
    // Someone set a challenge on a stretch you already skied that day: time those days now.
    const sessions = await listSessions();
    for (const c of fresh) {
      const seg = await getSegment(c.segmentId);
      if (!seg) continue;
      for (const s of sessions.filter((x) => localDate(x.startedAt) === c.date)) await matchSession(s.id, undefined, [seg]);
    }
    await onNewSegments?.();
  }
  return out;
}

async function uploadAttempts(challenges: CachedChallenge[]) {
  if (!challenges.length) return;
  const { playerId } = getSettings();
  const wanted = new Map<string, Set<string>>();
  for (const c of challenges) {
    if (!wanted.has(c.segmentId)) wanted.set(c.segmentId, new Set());
    wanted.get(c.segmentId)!.add(c.date);
  }
  for (const a of await listAttempts()) {
    if (a.playerId !== playerId) continue;
    const date = localDate(a.at);
    if (!wanted.get(a.segmentId)?.has(date)) continue;
    const key = `friends:att:${a.id}`;
    const sig = String(a.time);
    if ((await kvGet(key)) === sig) continue;
    await api.putAttempt(a.id, { segmentId: a.segmentId, date, time: a.time, at: a.at, ghost: a.ghost });
    await kvSet(key, sig);
  }
}

/** Forget upload markers, e.g. after switching to another server. */
export async function resetFriendsCache() {
  await kvSet('friends:groups', null);
  await kvSet('friends:challenges', null);
  await getDb().runAsync("DELETE FROM kv WHERE key LIKE 'friends:day:%' OR key LIKE 'friends:att:%'");
}
