import * as Linking from 'expo-linking';
import { Share } from 'react-native';
import { INVITE_PAGE_URL } from '../config';
import {
  deleteSessionAttempts, getPoints, getSegment, listAttempts, listSegments, listSessions, newId,
  saveSegment, upsertAttempts,
} from '../db';
import { fmtRaceTime } from '../lib/format';
import {
  attemptId, buildSegmentPath, findAttempts, GATE_RADIUS, leaderboard, type Attempt, type Segment,
} from '../lib/segments';
import { encodeChallenge, type ChallengePayload } from '../lib/share';
import { cleanTrack } from '../lib/stats';
import type { TrackPoint } from '../lib/types';
import { displayName, getSettings } from '../settings';

/** Turns a timed pass into one of your attempts. */
export function myAttempt(segment: Segment, sessionId: string, r: { startT: number; time: number; ghost: number[] }): Attempt {
  const { playerId } = getSettings();
  return {
    id: attemptId(playerId, r.startT),
    segmentId: segment.id,
    sessionId,
    playerId,
    playerName: displayName(),
    time: r.time,
    at: r.startT,
    ghost: r.ghost,
  };
}

/** Times a saved day against one or all challenges. Safe to run again: results are replaced. */
export async function matchSession(sessionId: string, points?: TrackPoint[], only?: Segment[]): Promise<Attempt[]> {
  const segments = only ?? (await listSegments());
  if (!segments.length) return [];
  const pts = points ?? (await getPoints(sessionId));
  const found: Attempt[] = [];
  for (const seg of segments) {
    await deleteSessionAttempts(sessionId, seg.id);
    const attempts = findAttempts(pts, seg).map((r) => myAttempt(seg, sessionId, r));
    await upsertAttempts(attempts);
    found.push(...attempts);
  }
  return found;
}

/** Looks through all your saved days for times on a (new) challenge. */
export async function scanHistory(segment: Segment): Promise<number> {
  let n = 0;
  for (const s of await listSessions()) n += (await matchSession(s.id, undefined, [segment])).length;
  return n;
}

/** Makes a challenge from part of a recorded run (indices into the cleaned track). */
export async function createChallenge(sessionId: string, from: number, to: number, name: string): Promise<Segment> {
  const pts = cleanTrack(await getPoints(sessionId));
  const segment: Segment = {
    id: `s-${newId()}`,
    name: name.trim() || 'My challenge',
    createdAt: Date.now(),
    creatorName: displayName(),
    path: buildSegmentPath(pts, from, to),
    gateRadius: GATE_RADIUS,
  };
  await saveSegment(segment);
  await scanHistory(segment);
  return segment;
}

/** Adds a challenge (or a friend's new times) from a link. Returns how many of your days had a time on it. */
export async function importChallenge(p: ChallengePayload): Promise<{ segmentId: string; isNew: boolean; foundInHistory: number }> {
  const existing = await getSegment(p.segment.id);
  if (!existing) await saveSegment(p.segment);
  const { playerId } = getSettings();
  // Your own times come back in your friend's reply; you already have them.
  await upsertAttempts(p.attempts.filter((a) => a.playerId !== playerId));
  const foundInHistory = existing ? 0 : await scanHistory(p.segment);
  return { segmentId: p.segment.id, isNew: !existing, foundInHistory };
}

/**
 * The link to share. A normal https link (always tappable in WhatsApp, Messages, …) to the
 * invite page, which shows the challenge and opens the app. Without a page configured,
 * falls back to a direct app link: skiapp://c?d=… (exp://…/--/c?d=… in Expo Go).
 */
export function challengeLink(code: string): string {
  if (INVITE_PAGE_URL) return `${INVITE_PAGE_URL}#d=${code}`;
  return Linking.createURL('c', { queryParams: { d: code } });
}

/** Opens the share sheet (WhatsApp, Messages, …) with an invite to beat the best time. */
export async function shareChallenge(segmentId: string, opts: { group?: boolean } = {}): Promise<void> {
  const segment = await getSegment(segmentId);
  if (!segment) return;
  const attempts = await listAttempts(segmentId);
  const me = getSettings().playerId;
  const board = leaderboard(attempts);
  const mine = board.find((e) => e.playerId === me);
  const leader = board[0];
  const code = encodeChallenge(segment, attempts, displayName());
  const link = challengeLink(code);

  let line: string;
  if (opts.group) {
    const top = board.slice(0, 5).map((e, i) => `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} ${e.playerName} ${fmtRaceTime(e.time)}`).join('\n');
    const message =
      `⛷️ Group challenge: “${segment.name}”! Ski it and get on the leaderboard.` +
      (top ? `\n\n${top}` : '') +
      `\n\nOpen the challenge:\n${link}`;
    await Share.share({ message, title: `Group ski challenge: ${segment.name}` });
    return;
  }
  if (mine && leader && leader.playerId === me) line = `I did “${segment.name}” in ${fmtRaceTime(mine.time)}. Think you can beat me?`;
  else if (mine && leader) line = `My time on “${segment.name}”: ${fmtRaceTime(mine.time)}. ${leader.playerName} leads with ${fmtRaceTime(leader.time)}. Your turn!`;
  else if (leader) line = `${leader.playerName} set ${fmtRaceTime(leader.time)} on “${segment.name}”. Can you beat it?`;
  else line = `Race me on “${segment.name}”!`;

  const message =
    `⛷️ ${line}\n\nSee the route and the time to beat:\n${link}`;
  await Share.share({ message, title: `Ski challenge: ${segment.name}` });
}
