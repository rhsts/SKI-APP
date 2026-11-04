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

export function friendsEnabled(): boolean {
  return !!getSettings().serverUrl;
}

async function call<T>(
  method: string, path: string, body?: unknown, base = getSettings().serverUrl, password = getSettings().serverPassword,
): Promise<T> {
  if (!base) throw new FriendsError('Set up your friends server in Profile first.');
  const { playerId, deviceSecret } = getSettings();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${playerId}:${deviceSecret}`,
        ...(password ? { 'x-server-password': password } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new FriendsError('Can’t reach the friends server. Check your internet connection and the server address.');
  } finally {
    clearTimeout(timer);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
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
    throw new FriendsError(err.error != null ? String(err.error) : `Server error (${res.status})`, res.status);
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

export const api = {
  hello: () => call<{ id: string; name: string }>('PUT', '/v1/me', { name: displayName() }),
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
