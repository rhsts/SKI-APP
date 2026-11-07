/**
 * The day screen: the day's numbers and a list of every run, no map.
 * Tapping a run opens that run's own screen (with the map).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { simulateDay } from '../../src/lib/sim';
import { computeStats } from '../../src/lib/stats';
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

const activities = computeStats(mockPoints).activities;
const runIndexes = activities.map((a, i) => (a.kind === 'run' ? i : -1)).filter((i) => i >= 0);

async function open() {
  await render(<DayScreen />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await screen.findByText('Test Mountain');
}

describe('day screen', () => {
  it('shows the day’s numbers and every run once, without a map or graph', async () => {
    await open();
    expect(screen.getByText('Top speed')).toBeTruthy();
    expect(screen.getByText('Peak altitude')).toBeTruthy();
    expect(screen.queryByLabelText(/Replay position/)).toBeNull();

    const runCards = screen.getAllByText(/^Run \d+$/);
    expect(runCards).toHaveLength(runIndexes.length);
    expect(new Set(runCards.map((c) => String(c.props.children))).size).toBe(runCards.length);
    // Only runs are listed: lifts and breaks are in the numbers above.
    expect(screen.queryAllByText(/^Lift \d+$/)).toHaveLength(0);
  });

  it('tapping a run opens that run on its own screen', async () => {
    await open();
    await act(async () => { fireEvent.press(screen.getByText('Run 2')); });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/run', params: { session: 'd1', i: String(runIndexes[1]) } });
  });
});
