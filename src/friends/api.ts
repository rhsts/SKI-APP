import type {
  BoardRow, ChallengeRow, DayUpload, Group, GroupChallenge, GroupDetail,
} from '../lib/groups';
import { segmentUpload } from '../lib/groups';
import type { Segment } from '../lib/segments';
import { displayName, getSettings, updateSettings } from '../settings';

/** Talks to the friends server (server/ in this repo, e.g. on a Raspberry Pi). */

export class FriendsError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly code: string | null = null) {
    super(message);
  }
}

const TIMEOUT_MS = 12000;
/** A whole day's GPS track is a few MB: on mountain signal that needs longer. */
const TRACK_TIMEOUT_MS = 60000;

let onLoggedOut: ((message: string) => Promise<void>) | null = null;
/** Called when the server says this phone was logged out (password changed on another phone). */
export function setLoggedOutHandler(fn: (message: string) => Promise<void>) {
  onLoggedOut = fn;
}

export function friendsEnabled(): boolean {
  return !!getSettings().serverUrl;
}

async function call<T>(
  method: string, path: string, body?: unknown, base = getSettings().serverUrl, password = getSettings().serverPassword,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  if (!base) throw new FriendsError('Set up your friends server in Profile first.');
  const { deviceId, deviceSecret } = getSettings();
  const ctrl = new AbortController();
  // The timer covers reading the answer too: a download that stalls halfway must not hang for ever.
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  let json: unknown = null;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${deviceId}:${deviceSecret}`,
        ...(password ? { 'x-server-password': password } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    try {
      json = await res.json();
    } catch {
      if (ctrl.signal.aborted) throw new Error('timed out');
      json = null; // not JSON: handled below by the status
    }
  } catch {
    throw new FriendsError('Can’t reach the friends server. Check your internet connection and the server address.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = (json && typeof json === 'object' ? json : {}) as { error?: unknown; code?: unknown };
    if (err.code === 'password') {
      // The saved password stopped working (it was changed on the server): lock the app again.
      const cur = getSettings();
      if (cur.unlocked && base === cur.serverUrl && password === cur.serverPassword) {
        updateSettings({ unlocked: false }).catch(() => undefined);
      }
      throw new FriendsError(
        password ? 'Wrong server password. Ask whoever runs the server for the right one.' : 'This server needs a password. Enter it in Profile → Friends server.',
        res.status, 'password',
      );
    }
    if (res.status === 401 && err.code === 'logged_out') {
      // Password changed on another phone: back to the log in screen (account.ts registers this).
      await onLoggedOut?.(String(err.error)).catch(() => undefined);
    }
    if (res.status === 401 && String(err.error ?? '').includes('removed')) {
      // An admin removed this skier: back to the lock screen.
      updateSettings({ unlocked: false, account: null }).catch(() => undefined);
    }
    throw new FriendsError(err.error != null ? String(err.error) : `Server error (${res.status})`, res.status, typeof err.code === 'string' ? err.code : null);
  }
  return json as T;
}

/** Checks that `base` is a Ski Tracker friends server and that `password` is right. */
export async function checkServer(base: string, password = ''): Promise<void> {
  const r = await call<{ ok?: boolean; app?: string; password?: boolean }>('GET', '/v1/health', undefined, base, password);
  if (r?.app !== 'ski-tracker-friends') throw new FriendsError('That address answers, but it isn’t a Ski Tracker friends server.');
  // An authenticated call: fails with a clear message if the password is missing or wrong.
  await call('GET', '/v1/groups', undefined, base, password);
}

export interface MeInfo { id: string; name: string; username: string | null; isAdmin: boolean; hasAvatar: boolean }

export interface PlayerTotals { days: number; vertical: number; topSpeed: number; runs: number; distance: number; skiTime: number }

export interface PlayerProfile {
  id: string;
  name: string;
  username: string | null;
  hasAvatar: boolean;
  createdAt: number;
  season: PlayerTotals & { key: string };
  allTime: PlayerTotals;
  recent: { date: string; vertical: number; topSpeed: number; runs: number }[];
  badges: { id: string; title: string; at: number | null }[];
}

export interface TrackInfo { dayId: string; startedAt: number; endedAt: number | null; place: string | null; sport: string | null; size: number; updatedAt: number }

export interface AdminPlayer {
  id: string; name: string; username: string | null; isAdmin: boolean; lastSeen: number | null; createdAt: number;
  hasAvatar: boolean; groups: number; days: number; backups: number; backupBytes: number; phones: number;
}

const enc = encodeURIComponent;

export const api = {
  hello: () => call<MeInfo>('PUT', '/v1/me', { name: displayName() }),
  me: () => call<MeInfo>('GET', '/v1/me'),
  register: (username: string, password: string, name: string) => call<MeInfo>('POST', '/v1/account/register', { username, password, name }),
  login: (username: string, password: string) => call<MeInfo>('POST', '/v1/account/login', { username, password }),
  logout: () => call<{ ok: true }>('POST', '/v1/account/logout'),
  changePassword: (old: string, password: string) => call<{ ok: true }>('PUT', '/v1/account/password', { old, password }),
  setAvatar: (jpeg: string) => call<{ ok: true }>('PUT', '/v1/me/avatar', { jpeg }),
  deleteAvatar: () => call<{ ok: true }>('DELETE', '/v1/me/avatar'),
  setProfile: (badges: { id: string; title: string; at: number | null }[]) => call<{ ok: true }>('PUT', '/v1/me/profile', { badges }),
  player: (id: string) => call<PlayerProfile>('GET', `/v1/players/${enc(id)}`),
  playerAvatar: (id: string) => call<{ jpeg: string | null }>('GET', `/v1/players/${enc(id)}/avatar`),
  tracks: () => call<TrackInfo[]>('GET', '/v1/me/tracks'),
  putTrack: (dayId: string, t: { startedAt: number; endedAt: number | null; place: string | null; sport: string; data: string }) =>
    call<{ ok: true }>('PUT', `/v1/me/tracks/${enc(dayId)}`, t, undefined, undefined, TRACK_TIMEOUT_MS),
  getTrack: (dayId: string) => call<TrackInfo & { data: string }>('GET', `/v1/me/tracks/${enc(dayId)}`, undefined, undefined, undefined, TRACK_TIMEOUT_MS),
  deleteTrack: (dayId: string) => call<{ ok: true }>('DELETE', `/v1/me/tracks/${enc(dayId)}`),
  adminPlayers: () => call<AdminPlayer[]>('GET', '/v1/admin/players'),
  adminRemove: (id: string) => call<{ ok: true }>('DELETE', `/v1/admin/players/${enc(id)}`),
  adminSetAdmin: (id: string, isAdmin: boolean) => call<{ ok: true }>('PUT', `/v1/admin/players/${enc(id)}/admin`, { isAdmin }),
  groups: () => call<Group[]>('GET', '/v1/groups'),
  group: (id: string) => call<GroupDetail>('GET', `/v1/groups/${encodeURIComponent(id)}`),
  createGroup: (name: string) => call<Group>('POST', '/v1/groups', { name }),
  joinGroup: (code: string) => call<Group>('POST', '/v1/groups/join', { code }),
  renameGroup: (id: string, name: string) => call<Group>('PATCH', `/v1/groups/${encodeURIComponent(id)}`, { name }),
  leaveGroup: (id: string) => call<{ ok: true }>('DELETE', `/v1/groups/${encodeURIComponent(id)}/members/me`),
  board: (id: string, date: string) => call<{ date: string; rows: BoardRow[] }>('GET', `/v1/groups/${encodeURIComponent(id)}/board?date=${date}`),
  addChallenge: (id: string, date: string, seg: Segment) =>
    call<GroupChallenge>('POST', `/v1/groups/${encodeURIComponent(id)}/challenges`, { date, segment: segmentUpload(seg) }),
  removeChallenge: (id: string, cid: string) =>
    call<{ ok: true }>('DELETE', `/v1/groups/${encodeURIComponent(id)}/challenges/${encodeURIComponent(cid)}`),
  challengeBoard: (id: string, cid: string) =>
    call<{ date: string; rows: ChallengeRow[] }>('GET', `/v1/groups/${encodeURIComponent(id)}/challenges/${encodeURIComponent(cid)}/board`),
  putDay: (dayId: string, d: DayUpload) => call<{ ok: true }>('PUT', `/v1/days/${encodeURIComponent(dayId)}`, d),
  deleteDay: (dayId: string) => call<{ ok: true }>('DELETE', `/v1/days/${encodeURIComponent(dayId)}`),
  putAttempt: (attemptId: string, a: { segmentId: string; date: string; time: number; at: number; ghost: number[] | null }) =>
    call<{ ok: true }>('PUT', `/v1/attempts/${encodeURIComponent(attemptId)}`, a),
};
