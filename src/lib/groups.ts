import type { PathPoint, Segment } from './segments';
import type { DayStats } from './types';

/** Shapes shared with the friends server (server/src/app.js). */

export interface Group {
  id: string;
  name: string;
  code: string;
  createdBy: string;
  createdAt: number;
  members: number;
}

export interface Member {
  playerId: string;
  name: string;
  joinedAt: number;
}

export interface GroupChallenge {
  id: string;
  segmentId: string;
  /** Local date of the challenge day, YYYY-MM-DD. */
  date: string;
  segment: Segment;
  createdBy: string;
  createdByName: string;
  createdAt: number;
}

export interface GroupDetail extends Omit<Group, 'members'> {
  members: Member[];
  /** Dates (newest first) on which any member skied. */
  dates: string[];
  challenges: GroupChallenge[];
}

export interface BoardRow {
  playerId: string;
  name: string;
  vertical: number;
  topSpeed: number;
  runs: number;
  distance: number;
  skiTime: number;
  /** Recordings that day (0 = didn't ski). */
  days: number;
}

export interface ChallengeRow {
  id: string;
  playerId: string;
  playerName: string;
  time: number;
  at: number;
  ghost: number[] | null;
}

export interface DayUpload {
  date: string;
  startedAt: number;
  vertical: number;
  topSpeed: number;
  runs: number;
  distance: number;
  skiTime: number;
}

export type BoardMetric = 'vertical' | 'topSpeed' | 'runs';

/** Local calendar date, YYYY-MM-DD: "the same day" for everyone in the group. */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** YYYY-MM-DD → local midnight in ms. */
export function dateToMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** What a finished day shares with your groups: totals only, never the GPS track. */
export function dayUpload(startedAt: number, s: DayStats): DayUpload {
  return {
    date: localDate(startedAt),
    startedAt,
    vertical: Math.round(s.verticalDown),
    topSpeed: Math.round(Math.min(s.topSpeed, 99) * 100) / 100,
    runs: s.runCount,
    distance: Math.round(s.skiDistance),
    skiTime: Math.round(s.skiTime),
  };
}

export interface RankedRow extends BoardRow {
  rank: number;
}

/**
 * Members ranked on one metric, best first; ties share a rank. People who
 * didn't ski that day go to the bottom without a rank.
 */
export function rankBoard(rows: BoardRow[], metric: BoardMetric): (RankedRow | (BoardRow & { rank: null }))[] {
  const skied = rows.filter((r) => r.days > 0).sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name));
  const rest = rows.filter((r) => r.days === 0).sort((a, b) => a.name.localeCompare(b.name));
  let rank = 0;
  const ranked = skied.map((r, i) => {
    if (i === 0 || r[metric] !== skied[i - 1][metric]) rank = i + 1;
    return { ...r, rank };
  });
  return [...ranked, ...rest.map((r) => ({ ...r, rank: null }))];
}

/** Best time per member, fastest first, ties share a rank. */
export function rankChallenge(rows: ChallengeRow[]): (ChallengeRow & { rank: number })[] {
  const best = new Map<string, ChallengeRow>();
  for (const r of rows) {
    const cur = best.get(r.playerId);
    if (!cur || r.time < cur.time) best.set(r.playerId, r);
  }
  const sorted = [...best.values()].sort((a, b) => a.time - b.time || a.at - b.at);
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.time !== sorted[i - 1].time) rank = i + 1;
    return { ...r, rank };
  });
}

/**
 * Cleans up what the user typed as server address: adds https:// when no
 * scheme was given (http:// is kept for a Pi on your home network) and drops a
 * trailing slash. Returns null if it can't be a web address.
 */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  s = s.replace(/\/+$/, '');
  const m = /^(https?):\/\/([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(:\d{1,5})?(\/[^\s?#]*)?$/i.exec(s);
  if (!m) return null;
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] ?? ''}${m[4] ?? ''}`;
}

/** Group codes are 6 letters/digits; people type them in any case and with spaces. */
export function cleanCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/** The challenge as the server wants it: just what's needed to time the stretch. */
export function segmentUpload(seg: Segment): { id: string; name: string; path: PathPoint[]; gateRadius: number; creatorName: string | null; createdAt: number } {
  return { id: seg.id, name: seg.name, path: seg.path, gateRadius: seg.gateRadius, creatorName: seg.creatorName, createdAt: seg.createdAt };
}

export interface InviteInfo {
  server: string | null;
  password: string | null;
  code: string | null;
}

/**
 * Reads a group invite message (as sent by the app's share button, or typed
 * by hand): the server address, the server password and the group code.
 */
export function parseInvite(text: string): InviteInfo {
  const servers = [...text.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((m) => m[0].replace(/[.,;:!?)]+$/, ''));
  // The app download link isn't the server.
  const server = servers.map(normalizeServerUrl).find((u) => u && !/github\.com|github\.io/.test(u)) ?? null;
  const pw = /password\s*[:=]\s*(\S+)/i.exec(text);
  const code = /\bcode\s*[:=]?\s*([A-Z0-9]{6})\b/i.exec(text);
  return { server, password: pw ? pw[1] : null, code: code ? code[1].toUpperCase() : null };
}
