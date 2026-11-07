/**
 * UI stress test of the run screen (where the map and graphs live): a few hundred
 * fast drags on the graph, which must never leave the page unable to scroll.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { simulateDay } from '../../src/lib/sim';
import { computeStats } from '../../src/lib/stats';
import type { TrackPoint } from '../../src/lib/types';

const SIM = simulateDay({ start: Date.UTC(2026, 1, 18, 8, 30), runs: 5, turns: true });
const mockPoints: TrackPoint[] = SIM.points;
const mockRun = String(computeStats(mockPoints).activities.findIndex((a) => a.kind === 'run'));

jest.mock('../../src/db', () => ({
  getSession: jest.fn(async () => ({
    id: 'd1', startedAt: mockPoints[0].t, endedAt: mockPoints[mockPoints.length - 1].t, place: 'Test Mountain',
    stats: null, isDemo: true, pistes: null, sport: 'ski',
  })),
  getPoints: jest.fn(async () => mockPoints),
  listPhotos: jest.fn(async () => []),
  listTrailMaps: jest.fn(async () => []),
}));
jest.mock('../../src/settings', () => {
  const s = { units: 'metric', theme: 'light', playerId: 'me', serverUrl: '', vibrate: true };
  return { useSettings: () => s, getSettings: () => s, updateSettings: jest.fn(), displayName: () => 'Me' };
});
jest.mock('../../src/lib/mapsAvailable', () => ({ mapsAvailable: false }));
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual('react-native');
  const C = (p: { children?: unknown }) => <View>{p.children as never}</View>;
  return { __esModule: true, default: C, Marker: C, Polyline: C, PROVIDER_GOOGLE: 'google' };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ session: 'd1', i: mockRun }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router/stack', () => {
  const S = () => null;
  S.Screen = () => null;
  return { __esModule: true, default: S };
});

// eslint-disable-next-line import/first
import RunScreen from '../../src/app/run';

function rng(seed: number) {
  let a = seed;
  return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const graph = () => screen.getByLabelText(/Replay position/);
const touch = (pageX: number) => ({ nativeEvent: { pageX, locationX: pageX - 16, pageY: 300, locationY: 60, touches: [], changedTouches: [], identifier: 1, target: 1, timestamp: Date.now() }, touchHistory: { touchBank: [] } });
const scrollEnabled = () => screen.getByTestId('run-scroll').props.scrollEnabled;
const readout = () => String(screen.queryAllByText(/^\d{1,2}:\d{2} · .*\d m$/)[0]?.props.children ?? 'none');

async function open() {
  await render(<RunScreen />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await screen.findByText('Next run');
  await act(async () => { fireEvent(graph(), 'layout', { nativeEvent: { layout: { width: 320, height: 140, x: 0, y: 0 } } }); });
}

describe('run screen under stress', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('survives hundreds of drags, and the page scrolls again after each one', async () => {
    const errors: unknown[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    await open();
    const r = rng(7);
    const readouts = new Set<string>();
    for (let round = 0; round < 40; round++) {
      await act(async () => { fireEvent(graph(), 'responderGrant', touch(16 + r() * 320)); });
      expect(scrollEnabled()).toBe(false);
      for (let k = 0; k < 8; k++) {
        await act(async () => { fireEvent(graph(), 'responderMove', touch(-40 + r() * 420)); jest.advanceTimersByTime(17); });
      }
      await act(async () => { fireEvent(graph(), round % 5 === 0 ? 'responderTerminate' : 'responderRelease', touch(100)); });
      expect(scrollEnabled()).toBe(true);
      readouts.add(readout());
    }
    // The cursor actually moved around.
    expect(readouts.size).toBeGreaterThan(10);
    spy.mockRestore();
    expect(errors.filter((e) => !String(e).includes('act('))).toEqual([]);
  }, 120000);

  it('a drag outside the graph clamps to the start/end instead of jumping', async () => {
    await open();
    await act(async () => { fireEvent(graph(), 'responderGrant', touch(100)); });
    await act(async () => { fireEvent(graph(), 'responderMove', touch(-500)); jest.advanceTimersByTime(17); });
    const atStart = readout();
    await act(async () => { fireEvent(graph(), 'responderMove', touch(5000)); jest.advanceTimersByTime(17); });
    const atEnd = readout();
    expect(atStart).not.toEqual('none');
    expect(atStart).not.toEqual(atEnd);
    await act(async () => { fireEvent(graph(), 'responderRelease', touch(5000)); });
  });
});
