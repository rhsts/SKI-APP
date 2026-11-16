/**
 * Meet-up pins: the text, the rough way there, typed times, and announcing each pin once.
 */
import { bearing, offset } from '../src/lib/geo';
import { parseMeetTime, pinText, pinWay, unseenPins } from '../src/lib/meet';

const mockSchedule = jest.fn(async (_r: unknown) => 'id');
const mockKv = new Map<string, string | null>();
let mockLive: Record<string, unknown> = {};
jest.mock('expo-notifications', () => ({ scheduleNotificationAsync: (r: unknown) => mockSchedule(r) }));
jest.mock('../src/db', () => ({
  kvGet: jest.fn(async (k: string) => mockKv.get(k) ?? null),
  kvSet: jest.fn(async (k: string, v: string | null) => { mockKv.set(k, v); }),
}));
jest.mock('../src/settings', () => ({ getSettings: () => ({ serverUrl: 'https://x', shareLive: true }) }));
jest.mock('../src/friends/sync', () => ({ cachedGroups: async () => [{ id: 'g1', name: 'Ischgl 2026' }] }));
jest.mock('../src/friends/api', () => ({
  friendsEnabled: () => true,
  FriendsError: class extends Error {},
  api: { postLive: jest.fn(async () => ({ ok: true })), groupLive: jest.fn(async () => mockLive) },
}));
// eslint-disable-next-line import/first
import { refreshLive } from '../src/friends/live';

const TOP = { lat: 47.01, lon: 10.29 };
const pin = (createdAt: number, mine = false) => ({
  ...TOP, label: 'Lunch at the top of the Gondola', meetAt: new Date(2026, 0, 17, 12, 30).getTime(),
  createdBy: 'p-ben', createdByName: 'Ben', createdAt, expiresAt: 0, mine,
});

describe('meet-up pins', () => {
  it('reads as label and time', () => {
    expect(pinText(pin(1))).toBe('Lunch at the top of the Gondola, 12:30');
    expect(pinText({ label: 'Car park', meetAt: null })).toBe('Car park');
  });

  it('says how far and which way', () => {
    expect(bearing(TOP, offset(TOP, 90, 500))).toBeCloseTo(90, 0);
    expect(pinWay(TOP, offset(TOP, 45, 450), 'metric')).toBe('450 m north-east of you');
    expect(pinWay(TOP, offset(TOP, 180, 2000), 'metric')).toBe('2.0 km south of you');
    expect(pinWay(TOP, offset(TOP, 0, 10), 'metric')).toBe('You are here');
  });

  it('reads typed times as today, or tomorrow once well past', () => {
    const now = new Date(2026, 0, 17, 10, 0).getTime();
    expect(parseMeetTime('12:30', now)).toBe(new Date(2026, 0, 17, 12, 30).getTime());
    expect(parseMeetTime('1230', now)).toBe(new Date(2026, 0, 17, 12, 30).getTime());
    expect(parseMeetTime('12', now)).toBe(new Date(2026, 0, 17, 12, 0).getTime());
    expect(parseMeetTime('9:30', now)).toBe(new Date(2026, 0, 17, 9, 30).getTime()); // just missed: still today
    expect(parseMeetTime('7:00', now)).toBe(new Date(2026, 0, 18, 7, 0).getTime());
    expect(parseMeetTime('25:00', now)).toBeNull();
    expect(parseMeetTime('noon', now)).toBeNull();
  });

  it('only someone else’s pin, and only once', () => {
    const pins = [{ ...pin(5), groupId: 'g1' }, { ...pin(6, true), groupId: 'g2' }];
    expect(unseenPins(pins, {}).map((p) => p.groupId)).toEqual(['g1']);
    expect(unseenPins(pins, { g1: 5 })).toEqual([]);
    expect(unseenPins([{ ...pin(7), groupId: 'g1' }], { g1: 5 })).toHaveLength(1); // changed pin
  });

  it('a poll notifies once per new or changed pin', async () => {
    mockLive = { members: [], pin: null };
    await refreshLive(TOP);
    expect(mockSchedule).not.toHaveBeenCalled();

    mockLive = { members: [], pin: pin(100) };
    await refreshLive(TOP);
    await refreshLive(TOP);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0]).toMatchObject({
      identifier: 'meet-pin-g1',
      content: { title: 'Ben set a meet-up', body: 'Lunch at the top of the Gondola, 12:30 · Ischgl 2026' },
      trigger: null,
    });

    mockLive = { members: [], pin: pin(200) };
    await refreshLive(TOP);
    expect(mockSchedule).toHaveBeenCalledTimes(2);

    mockLive = { members: [], pin: pin(300, true) }; // your own: no notification
    await refreshLive(TOP);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mockKv.get('live:seenPins')!)).toEqual({ g1: 200 });
  });
});
