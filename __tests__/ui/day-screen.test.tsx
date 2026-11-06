/**
 * UI stress test of the day screen: a real (simulated) ski day, then a few hundred
 * fast drags on the graph mixed with taps on runs, lifts, play and the timeline.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { simulateDay } from '../../src/lib/sim';
import type { TrackPoint } from '../../src/lib/types';

const SIM = simulateDay({ start: Date.UTC(2026, 1, 18, 8, 30), runs: 5, turns: true });
const mockPoints: TrackPoint[] = SIM.points;
const mockMotion = SIM.motion.map((e) => ({ ...e, lat: 47, lon: 10 }));

jest.mock('../../src/db', () => ({
  getSession: jest.fn(async () => ({
    id: 'd1', startedAt: mockPoints[0].t, endedAt: mockPoints[mockPoints.length - 1].t, place: 'Test Mountain',
    stats: null, isDemo: true, pistes: null, sport: 'ski',
  })),
  getPoints: jest.fn(async () => mockPoints),
  listPhotos: jest.fn(async () => []),
  listMotionEvents: jest.fn(async () => mockMotion),
  listSessionAttempts: jest.fn(async () => []),
  listSegments: jest.fn(async () => []),
  listTrailMaps: jest.fn(async () => []),
  kvGet: jest.fn(async () => '1'),
  kvSet: jest.fn(async () => undefined),
  deleteSession: jest.fn(), deleteMotionEvent: jest.fn(), renameSession: jest.fn(), setSessionSport: jest.fn(),
}));
jest.mock('../../src/settings', () => {
  const s = { units: 'metric', theme: 'light', playerId: 'me', serverUrl: '', vibrate: true };
  return { useSettings: () => s, getSettings: () => s, updateSettings: jest.fn(), displayName: () => 'Me' };
});
jest.mock('../../src/mountain/pistes', () => ({ lookupPistes: jest.fn(async () => null), pistesUpToDate: () => true }));
jest.mock('../../src/days/files', () => ({ exportGpx: jest.fn() }));
jest.mock('../../src/days/photos', () => ({ addPhotos: jest.fn(), removePhoto: jest.fn() }));
jest.mock('../../src/friends/api', () => ({ api: {}, friendsEnabled: () => false }));
jest.mock('../../src/lib/mapsAvailable', () => ({ mapsAvailable: false }));
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual('react-native');
  const C = (p: { children?: unknown }) => <View>{p.children as never}</View>;
  return { __esModule: true, default: C, Marker: C, Polyline: C, PROVIDER_GOOGLE: 'google' };
});
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
    useLocalSearchParams: () => ({ id: 'd1' }),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router/stack', () => {
  const S = () => null;
  S.Screen = () => null;
  return { __esModule: true, default: S };
});

// eslint-disable-next-line import/first
import DayScreen from '../../src/app/day/[id]';

function rng(seed: number) {
  let a = seed;
  return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const graph = () => screen.getByLabelText(/Replay position/);
const touch = (pageX: number) => ({ nativeEvent: { pageX, locationX: pageX - 16, pageY: 300, locationY: 60, touches: [], changedTouches: [], identifier: 1, target: 1, timestamp: Date.now() }, touchHistory: { touchBank: [] } });
const scrollEnabled = () => screen.getByTestId('day-scroll').props.scrollEnabled;

describe('day screen under stress', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('survives hundreds of drags mixed with run taps, play and timeline taps', async () => {
    const errors: unknown[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    await render(<DayScreen />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await screen.findByText('Test Mountain');

    // Lay out the graph so drags map to positions.
    await act(async () => { fireEvent(graph(), 'layout', { nativeEvent: { layout: { width: 320, height: 140, x: 0, y: 0 } } }); });
    // Each run is listed once (in the timeline), not also as a row of buttons.
    const runCards = screen.getAllByText(/^Run \d+$/);
    expect(runCards.length).toBeGreaterThanOrEqual(5);
    expect(new Set(runCards.map((c) => String(c.props.children))).size).toBe(runCards.length);
    // Next / previous step through the runs.
    expect(screen.getByText(/^Run 1 of \d+$/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Next run')); });
    expect(screen.getByText(/^Run 2 of \d+$/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Previous run')); });
    expect(screen.getByText(/^Run 1 of \d+$/)).toBeTruthy();

    const r = rng(7);

    let readouts = new Set<string>();
    for (let round = 0; round < 40; round++) {
      // Start a drag; the page must stop scrolling while the finger is down.
      await act(async () => { fireEvent(graph(), 'responderGrant', touch(16 + r() * 320)); });
      expect(scrollEnabled()).toBe(false);
      for (let k = 0; k < 8; k++) {
        await act(async () => { fireEvent(graph(), 'responderMove', touch(-40 + r() * 420)); jest.advanceTimersByTime(17); });
      }
      // Sometimes tap a run (timeline or arrows) while the finger is still on the graph (the reported bug).
      if (round % 3 === 0) {
        const runCards = screen.getAllByText(/^Run \d+$/);
        await act(async () => { fireEvent.press(runCards[Math.floor(r() * runCards.length)]); });
      } else if (round % 3 === 1) {
        await act(async () => { fireEvent.press(screen.getByLabelText(r() < 0.5 ? 'Next run' : 'Previous run')); });
      }
      await act(async () => {
        fireEvent(graph(), round % 5 === 0 ? 'responderTerminate' : 'responderRelease', touch(100));
      });
      expect(scrollEnabled()).toBe(true);
      readouts.add(String(screen.queryAllByText(/^\d{1,2}:\d{2} · .*\d m( · |$)/)[0]?.props.children ?? 'none'));

      // Mix in play/pause and timeline taps.
      if (round % 4 === 1) {
        await act(async () => { fireEvent.press(screen.getByLabelText(/Replay run \d+|Pause replay/)); });
        await act(async () => { jest.advanceTimersByTime(300 + r() * 2000); });
      }
      if (round % 4 === 2) {
        const lifts = screen.queryAllByText(/^Lift \d+$/);
        if (lifts.length) await act(async () => { fireEvent.press(lifts[Math.floor(r() * lifts.length)]); });
      }
    }
    // The cursor actually moved around.
    expect(readouts.size).toBeGreaterThan(10);
    spy.mockRestore();
    expect(errors.filter((e) => !String(e).includes('act('))).toEqual([]);
    readouts = new Set();
  }, 120000);

  it('a drag outside the graph clamps to the start/end instead of jumping', async () => {
    await render(<DayScreen />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await screen.findByText('Test Mountain');
    await act(async () => { fireEvent(graph(), 'layout', { nativeEvent: { layout: { width: 320, height: 140, x: 0, y: 0 } } }); });
    await act(async () => { fireEvent(graph(), 'responderGrant', touch(100)); });
    await act(async () => { fireEvent(graph(), 'responderMove', touch(-500)); jest.advanceTimersByTime(17); });
    const atStart = screen.getAllByText(/^\d{1,2}:\d{2} · .*\d m( · |$)/)[0].props.children;
    await act(async () => { fireEvent(graph(), 'responderMove', touch(5000)); jest.advanceTimersByTime(17); });
    const atEnd = screen.getAllByText(/^\d{1,2}:\d{2} · .*\d m( · |$)/)[0].props.children;
    expect(atStart).not.toEqual(atEnd);
    await act(async () => { fireEvent(graph(), 'responderRelease', touch(5000)); });
  });
});
