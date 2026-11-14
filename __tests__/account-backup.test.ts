/**
 * @jest-environment node
 */
// Online backup, deleting days and logging out, against a fake phone database and server.
const mockKv = new Map<string, string>();
const mockSessions: { id: string; startedAt: number; endedAt: number; place: string | null; sport: string; isDemo: boolean }[] = [];
const mockSettings: Record<string, unknown> = {};
const mockGetPoints = jest.fn(async (..._a: unknown[]) => [{ t: 1 }, { t: 2 }]);
jest.mock('../src/db', () => ({
  kvGet: async (k: string) => mockKv.get(k) ?? null,
  kvSet: async (k: string, v: string | null) => { if (v == null) mockKv.delete(k); else mockKv.set(k, v); },
  listSessions: async () => [...mockSessions],
  deleteSession: async (id: string) => { mockSessions.splice(mockSessions.findIndex((s) => s.id === id), 1); },
  getPoints: (...a: unknown[]) => mockGetPoints(...a),
  countPoints: async () => 2,
  listMotionEvents: async () => [],
  getDb: () => ({ runAsync: async () => undefined }),
}));
jest.mock('../src/lib/trackpack', () => ({ packDay: (d: { startedAt: number }) => (d.startedAt === 3 ? 'x'.repeat(6_000_001) : 'AAAA') }));
jest.mock('../src/settings', () => ({
  getSettings: () => mockSettings,
  newIdentity: () => ({ playerId: 'fresh' }),
  updateSettings: async (p: object) => { Object.assign(mockSettings, p); },
}));
jest.mock('../src/challenges/service', () => ({ matchSession: jest.fn() }));
jest.mock('../src/friends/avatars', () => ({ forgetAvatar: jest.fn(), setMyAvatar: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../src/friends/api', () => {
  class FriendsError extends Error {
    constructor(message: string, readonly status: number | null = null) { super(message); }
  }
  return {
    FriendsError,
    friendsEnabled: () => true,
    setLoggedOutHandler: jest.fn(),
    api: { putTrack: jest.fn(), deleteDay: jest.fn(), deleteTrack: jest.fn(), tracks: jest.fn(), logout: jest.fn() },
  };
});
/* eslint-disable import/first */
import { api, FriendsError } from '../src/friends/api';
import { backupDays, loggedOutElsewhere, logOut, missingBackups } from '../src/friends/account';
import { deleteDayOnline, flushPendingDeletes } from '../src/friends/sync';
/* eslint-enable import/first */

const m = api as unknown as Record<string, jest.Mock>;
const day = (id: string, startedAt: number) => ({ id, startedAt, endedAt: startedAt + 1, place: null, sport: 'ski', isDemo: false });

beforeEach(() => {
  mockKv.clear();
  mockSessions.splice(0, mockSessions.length, day('a', 1 * 86400000), day('b', 2 * 86400000), day('big', 3));
  Object.assign(mockSettings, { account: { username: 'anna', isAdmin: false }, backupDays: true, playerId: 'p-anna', serverUrl: 'http://x' });
  for (const f of Object.values(m)) f.mockReset().mockResolvedValue({ ok: true });
});

describe('online backup', () => {
  it('one bad day doesn’t stop the others; a too-big day isn’t packed again', async () => {
    m.putTrack.mockImplementation(async (id: string) => { if (id === 'a') throw new FriendsError('Server error (500)', 500); return { ok: true }; });
    expect(await backupDays()).toEqual({ uploaded: 1, failed: 1, tooBig: 1 });
    expect(m.putTrack.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    m.putTrack.mockClear().mockResolvedValue({ ok: true });
    expect(await backupDays()).toEqual({ uploaded: 1, failed: 0, tooBig: 1 });
    expect(m.putTrack.mock.calls.map((c) => c[0])).toEqual(['a']);
  });

  it('doesn’t load the GPS track of a day that is already backed up', async () => {
    m.putTrack.mockResolvedValue({ ok: true });
    await backupDays();
    mockGetPoints.mockClear();
    expect(await backupDays()).toEqual({ uploaded: 0, failed: 0, tooBig: 1 });
    expect(mockGetPoints).not.toHaveBeenCalled();
  });

  it('a deleted day is removed online, retried when offline, and never offered back', async () => {
    m.tracks.mockResolvedValue([{ dayId: 'gone', startedAt: 9e9 }]);
    m.deleteTrack.mockRejectedValue(new FriendsError('offline'));
    await deleteDayOnline('gone');
    expect(await missingBackups()).toEqual([]);
    m.deleteTrack.mockResolvedValue({ ok: true });
    expect(await flushPendingDeletes()).toBe(0);
    expect(m.deleteDay).toHaveBeenCalledWith('gone');
    expect(m.deleteTrack).toHaveBeenLastCalledWith('gone');
  });
});

describe('log out', () => {
  it('refuses without an account or while recording, keeping the days', async () => {
    mockKv.set('active', '{}');
    await expect(logOut()).rejects.toThrow('Stop recording');
    mockKv.delete('active');
    mockSettings.account = null;
    await expect(logOut(true)).rejects.toThrow('not logged in');
    expect(mockSessions).toHaveLength(3);
    expect(m.logout).not.toHaveBeenCalled();
  });

  it('logged out by the server: days stay, account and identity go', async () => {
    await loggedOutElsewhere('Log in again.');
    expect(mockSessions).toHaveLength(3);
    expect(mockSettings).toMatchObject({ account: null, playerId: 'fresh' });
  });

  it('changes nothing when the days can’t be saved', async () => {
    m.putTrack.mockRejectedValue(new FriendsError('offline'));
    await expect(logOut()).rejects.toThrow('Can’t log out');
    expect(mockSessions).toHaveLength(3);
    expect(mockSettings.account).toBeTruthy();
    expect(m.logout).not.toHaveBeenCalled();
  });

  it('asks before dropping days too big to save, then removes all days and the identity', async () => {
    mockSettings.backupDays = false; // still saved when logging out
    expect(await logOut()).toEqual({ unsaved: 1 });
    expect(mockSessions).toHaveLength(3);
    expect(await logOut(true)).toEqual({ unsaved: 0 });
    expect(m.putTrack).toHaveBeenCalledTimes(2);
    expect(mockSessions).toHaveLength(0);
    expect(mockSettings).toMatchObject({ account: null, playerId: 'fresh' });
  });
});
