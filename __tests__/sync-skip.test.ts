/**
 * One day or time the server won't take must not stop the rest of the sync.
 */
const mockKv = new Map<string, string | null>();
const mockPutDay = jest.fn();
const mockPutAttempt = jest.fn();
const mockDay = (id: string, startedAt: number) => ({
  id, startedAt, isDemo: false,
  stats: { verticalDown: 1000, topSpeed: 20, runCount: 5, skiDistance: 5000, skiTime: 3000 },
});
const mockNow = Date.now();

jest.mock('../src/friends/api', () => {
  class FriendsError extends Error {
    constructor(message: string, readonly status: number | null = null) { super(message); }
  }
  return {
    FriendsError,
    friendsEnabled: () => true,
    api: {
      hello: async () => ({ id: 'me', name: 'Me', username: null, isAdmin: false }),
      groups: async () => [{ id: 'g1', name: 'G' }],
      group: async () => ({ challenges: [{ id: 'c1', segmentId: 's1', date: '2099-01-01', segment: { name: 'X' } }] }),
      putDay: (...a: unknown[]) => mockPutDay(...a),
      putAttempt: (...a: unknown[]) => mockPutAttempt(...a),
    },
  };
});
jest.mock('../src/db', () => ({
  kvGet: async (k: string) => mockKv.get(k) ?? null,
  kvSet: async (k: string, v: string | null) => { mockKv.set(k, v); },
  listSessions: async () => [mockDay('bad', mockNow - 2000), mockDay('good', mockNow - 1000)],
  getSegment: async () => ({ id: 's1' }),
  saveSegment: async () => undefined,
  listAttempts: async () => [],
  getDb: () => ({ runAsync: async () => undefined }),
}));
jest.mock('../src/settings', () => ({ getSettings: () => ({ playerId: 'me', account: null, shareDemoDays: false }), updateSettings: async () => undefined }));
jest.mock('../src/challenges/service', () => ({ matchSession: async () => [] }));

// eslint-disable-next-line import/first
import { FriendsError } from '../src/friends/api';
// eslint-disable-next-line import/first
import { syncFriends } from '../src/friends/sync';

it('skips a day the server refuses and uploads the others', async () => {
  mockPutDay.mockImplementation(async (id: string) => { if (id === 'bad') throw new FriendsError('Invalid number', 400); });
  await syncFriends();
  expect(mockPutDay).toHaveBeenCalledTimes(2);
  expect(mockKv.get('friends:day:good')).toBeTruthy();
  expect(mockKv.get('friends:day:bad')).toBeUndefined();
  // Got as far as the challenges.
  expect(mockKv.get('friends:challenges')).toContain('c1');
});

it('still stops when the server can’t be reached', async () => {
  mockKv.clear();
  mockPutDay.mockReset().mockRejectedValue(new FriendsError('Can’t reach the friends server.'));
  await expect(syncFriends()).rejects.toThrow('reach');
  expect(mockPutDay).toHaveBeenCalledTimes(1);
});
