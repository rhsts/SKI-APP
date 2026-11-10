/**
 * The recorder's start/stop/recover flow, with the database, GPS and sensors faked.
 */
import { act, renderHook } from '@testing-library/react-native';
import type { Activity } from '../src/lib/types';

const mockKv = new Map<string, string | null>();
const mockSessions = new Map<string, { endedAt: number | null; place: string | null }>();
let mockPoints: { t: number; lat: number; lon: number; alt: number; spd: number }[] = [];
let mockRuns: Activity[] = [];
const mockFinish = jest.fn(async (id: string, endedAt: number, _s: unknown, place: string | null) => {
  mockSessions.set(id, { endedAt, place });
});
const mockStopMotion = jest.fn();
const mockWatch = jest.fn();
const mockLookupPlace = jest.fn();

jest.mock('../src/db', () => ({
  createSession: jest.fn(async () => { const id = `s${mockSessions.size + 1}`; mockSessions.set(id, { endedAt: null, place: null }); return id; }),
  deleteSession: jest.fn(async (id: string) => { mockSessions.delete(id); }),
  deleteUnfinishedSessions: jest.fn(async () => undefined),
  finishSession: (...a: [string, number, unknown, string | null]) => mockFinish(...a),
  getSession: jest.fn(async (id: string) => (mockSessions.has(id) ? { id, ...mockSessions.get(id) } : null)),
  getPoints: jest.fn(async (_id: string, after = -1) => mockPoints.filter((p) => p.t > after)),
  insertPoints: jest.fn(async () => undefined),
  insertMotionEvents: jest.fn(async () => undefined),
  deleteMotionEvent: jest.fn(async () => undefined),
  listMotionEvents: jest.fn(async () => []),
  listSegments: jest.fn(async () => []),
  listAttempts: jest.fn(async () => []),
  upsertAttempts: jest.fn(async () => undefined),
  kvGet: jest.fn(async (k: string) => mockKv.get(k) ?? null),
  kvSet: jest.fn(async (k: string, v: string | null) => { mockKv.set(k, v); }),
}));
jest.mock('../src/tracking/task', () => ({
  LOCATION_TASK: 'loc',
  locationTaskOptions: () => ({}),
  resetGpsState: jest.fn(async () => undefined),
  toTrackPoint: (l: unknown) => l,
  readActive: jest.fn(async () => { const raw = mockKv.get('active'); return raw ? JSON.parse(raw) : null; }),
}));
jest.mock('../src/tracking/motion', () => ({ startMotion: jest.fn(async () => true), stopMotion: () => mockStopMotion() }));
jest.mock('../src/tracking/place', () => ({ lookupPlace: (...a: unknown[]) => mockLookupPlace(...a) }));
jest.mock('../src/tracking/barometer', () => ({ startBarometer: jest.fn(async () => undefined), stopBarometer: jest.fn(), readPressure: jest.fn(async () => null) }));
jest.mock('../src/tracking/geofence', () => ({ refreshGeofences: jest.fn(async () => undefined) }));
jest.mock('../src/mountain/pistes', () => ({ lookupPistes: jest.fn(async () => null) }));
jest.mock('../src/friends/sync', () => ({ setNewSegmentsHandler: jest.fn(), syncFriends: jest.fn(async () => undefined) }));
jest.mock('../src/challenges/service', () => ({ matchSession: jest.fn(async () => undefined), myAttempt: jest.fn() }));
jest.mock('../src/settings', () => {
  const s = { motion: true, vibrate: false, fallCheck: true, playerId: 'me' };
  return { getSettings: () => s };
});
jest.mock('../src/lib/stats', () => ({ ...jest.requireActual('../src/lib/stats'), completedRuns: () => mockRuns }));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  watchPositionAsync: (...a: unknown[]) => mockWatch(...a),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn() }));
jest.mock('expo-battery', () => ({ getBatteryLevelAsync: jest.fn(async () => -1) }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined), impactAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: {}, ImpactFeedbackStyle: {},
}));

// eslint-disable-next-line import/first
import { dismissLastRun, recoverActiveDay, startDay, stopDay, useTracker } from '../src/tracking/tracker';
// eslint-disable-next-line import/first
import { matchSession } from '../src/challenges/service';

/** 3 minutes of slow movement: long enough to keep as a day. */
const day = (from = 0) => Array.from({ length: 180 }, (_, i) => ({ t: 1e12 + (from + i) * 1000, lat: 47 + (from + i) * 1e-5, lon: 10, alt: 2000, spd: 1 }));
const activeId = () => (mockKv.get('active') ? JSON.parse(mockKv.get('active')!).sessionId : null);
const run = (duration: number) => ({ topSpeed: 10, verticalDown: 100, distance: 500, duration }) as Activity;

beforeEach(() => {
  mockPoints = [];
  mockRuns = [];
  mockFinish.mockClear();
  mockStopMotion.mockClear();
  mockWatch.mockReset();
  mockLookupPlace.mockReset();
});

describe('tracker', () => {
  it('a failed start releases the motion sensor so the next day still gets jumps and falls', async () => {
    mockWatch.mockRejectedValueOnce(new Error('GPS off'));
    await startDay(false);
    expect(mockStopMotion).toHaveBeenCalled();
    expect(mockKv.get('active')).toBeNull();
  });

  it('keeps the day when the place lookup fails', async () => {
    mockWatch.mockResolvedValue({ remove: jest.fn() });
    mockLookupPlace.mockRejectedValue(new Error('no signal'));
    await startDay(false);
    const id = activeId();
    mockPoints = day();
    expect(await stopDay()).toBe(id);
    expect(mockSessions.get(id)!.endedAt).toBe(mockPoints[mockPoints.length - 1].t);
    expect(mockKv.get('active')).toBeNull();
  });

  it('keeps pointing at the day when saving fails, so Finish can be tried again', async () => {
    mockWatch.mockResolvedValue({ remove: jest.fn() });
    mockLookupPlace.mockResolvedValue('Ischgl');
    const { result } = await renderHook(() => useTracker());
    await act(() => startDay(false));
    const id = activeId();
    mockPoints = day();
    mockFinish.mockRejectedValueOnce(new Error('disk full'));
    await act(() => expect(stopDay()).rejects.toThrow('disk full'));
    expect(activeId()).toBe(id);
    expect(result.current.status).toBe('paused');
    await act(async () => { expect(await stopDay()).toBe(id); });
    expect(mockSessions.get(id)!.place).toBe('Ischgl');
    expect(result.current.status).toBe('idle');
  });

  it('a double tap on Start records one day, not two', async () => {
    mockWatch.mockResolvedValue({ remove: jest.fn() });
    mockLookupPlace.mockResolvedValue(null);
    const before = mockSessions.size;
    await Promise.all([startDay(false), startDay(false)]);
    expect(mockSessions.size).toBe(before + 1);
    expect(mockWatch).toHaveBeenCalledTimes(1);
    mockPoints = day();
    await stopDay();
  });

  it('finishes the day even when timing its challenges fails', async () => {
    mockWatch.mockResolvedValue({ remove: jest.fn() });
    mockLookupPlace.mockResolvedValue(null);
    const { result } = await renderHook(() => useTracker());
    await act(() => startDay(false));
    const id = activeId();
    mockPoints = day();
    (matchSession as jest.Mock).mockRejectedValueOnce(new Error('db busy'));
    await act(async () => { expect(await stopDay()).toBe(id); });
    expect(result.current.status).toBe('idle');
  });

  it('at launch, forgets an active day that was already saved', async () => {
    mockSessions.set('done', { endedAt: 5, place: null });
    mockKv.set('active', JSON.stringify({ sessionId: 'done', startedAt: 1, paused: false, source: 'gps' }));
    const { result } = await renderHook(() => useTracker());
    await act(() => recoverActiveDay());
    expect(mockKv.get('active')).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('announces a run again after two pieces were merged into one', async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderHook(() => useTracker());
      await act(() => startDay(true));
      const pts = day();
      let i = 0;
      const tick = async (runs: Activity[]) => {
        mockRuns = runs;
        mockPoints = pts.slice(0, ++i);
        await act(() => jest.advanceTimersByTimeAsync(1000));
      };
      await tick([run(60)]);
      expect(result.current.lastRun?.number).toBe(1);
      await tick([run(60), run(30)]); // mid-run stop looked like a finished run
      expect(result.current.lastRun?.number).toBe(2);
      await act(async () => dismissLastRun());
      await tick([run(60)]); // ...then merged back into the run still going
      expect(result.current.lastRun).toBeNull();
      await tick([run(60), run(90)]); // the real end of run 2
      expect(result.current.lastRun).toMatchObject({ number: 2, duration: 90 });
      await act(async () => { await stopDay(); });
    } finally {
      jest.useRealTimers();
    }
  });
});
