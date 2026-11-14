/**
 * The Record tab: the idle screen with its one Start control, the live instrument
 * layout, and the moments (new top speed, run done) that appear on top of it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { simulateDay } from '../../src/lib/sim';
import { computeStats } from '../../src/lib/stats';
import type { TrackerState } from '../../src/tracking/tracker';

const SIM = simulateDay({ start: Date.UTC(2026, 1, 18, 8, 30), runs: 5, turns: true });

const IDLE: TrackerState = {
  status: 'idle', active: null, points: [], stats: null, currentSpeed: 0, lastFixAt: null,
  foregroundOnly: false, recovered: false, error: null, race: null, finish: null,
  lastRun: null, newTop: null, battery: null, autoPaused: false,
  motion: { jumps: 0, bestAir: 0, totalAir: 0, falls: 0 }, motionLive: false, jump: null, fallAlert: null,
};
const LIVE: TrackerState = {
  ...IDLE,
  status: 'recording',
  active: { sessionId: 's1', startedAt: SIM.points[0].t, paused: false, source: 'gps' },
  points: SIM.points,
  stats: computeStats(SIM.points),
  currentSpeed: 17.2, // 62 km/h
  battery: { level: 0.74, hoursLeft: 13 },
};

let mockState: TrackerState = IDLE;
const mockStart = jest.fn(async () => undefined);
const mockStop = jest.fn(async () => 'd1');
const mockDismissRun = jest.fn();

jest.mock('../../src/tracking/tracker', () => ({
  useTracker: () => mockState,
  startDay: (...a: unknown[]) => mockStart(...(a as [])),
  stopDay: () => mockStop(),
  pauseDay: jest.fn(async () => undefined),
  resumeDay: jest.fn(async () => undefined),
  dismissLastRun: () => mockDismissRun(),
  dismissFall: jest.fn(), dismissFinish: jest.fn(), notAFall: jest.fn(async () => undefined),
}));
jest.mock('../../src/settings', () => {
  const s = { units: 'metric', theme: 'light', playerId: 'me', serverUrl: '', vibrate: false, simulate: false, sport: 'ski' };
  return { useSettings: () => s, getSettings: () => s, updateSettings: jest.fn() };
});
jest.mock('../../src/db', () => ({ listTrailMaps: jest.fn(async () => []), sessionStarts: jest.fn(async () => []) }));
jest.mock('../../src/days/badges', () => ({ badgesEarnedBy: jest.fn(async () => []) }));
jest.mock('../../src/mountain/pistes', () => ({ downloadTrailMap: jest.fn(async () => null) }));
jest.mock('../../src/mountain/weather', () => ({ getWeather: jest.fn(async () => null) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined), notificationAsync: jest.fn(async () => undefined), selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: {}, NotificationFeedbackType: {},
}));
jest.mock('expo-blur', () => ({ BlurView: () => null }));
jest.mock('expo-battery', () => ({ useBatteryLevel: () => 0.86 }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../src/lib/mapsAvailable', () => ({ mapsAvailable: false }));
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual('react-native');
  const C = (p: { children?: unknown }) => <View>{p.children as never}</View>;
  return { __esModule: true, default: C, Marker: C, Polyline: C, PROVIDER_GOOGLE: 'google' };
});

// eslint-disable-next-line import/first
import RecordScreen from '../../src/app/(tabs)/index';

async function open(state: TrackerState) {
  mockState = state;
  await render(<RecordScreen />);
  await act(async () => { await Promise.resolve(); });
}

describe('record screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('idle: one Start control and SOS, no live figures', async () => {
    await open(IDLE);
    expect(screen.getByLabelText(/^Emergency/)).toBeTruthy();
    expect(screen.queryByText('Top speed')).toBeNull();
    expect(screen.getByText('86% battery')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Start recording your day')); });
    expect(mockStart).toHaveBeenCalledWith(false, 'ski');
  });

  it('recording: a live figure you can switch, and the day’s numbers', async () => {
    await open(LIVE);
    expect(screen.getByLabelText('Speed: 62 km/h')).toBeTruthy();
    expect(screen.getByText('Top speed')).toBeTruthy();
    expect(screen.getByText(/74% · about 13 h 00 of tracking left/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Vertical')); });
    expect(screen.getByLabelText(/^Vertical: [\d,]+ m$/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Time')); });
    expect(screen.getByLabelText(/^Time: \d+:\d\d (min|h)$/)).toBeTruthy();
  });

  it('finishing takes a held press; a tap only asks', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open(LIVE);
    const finish = screen.getByLabelText('Finish your day');
    await act(async () => { fireEvent.press(finish); });
    expect(alert).toHaveBeenCalledWith('Finish your day?', expect.any(String), expect.any(Array));
    expect(mockStop).not.toHaveBeenCalled();
    await act(async () => { fireEvent(finish, 'longPress'); });
    expect(mockStop).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('a new top speed takes over the big figure', async () => {
    await open({ ...LIVE, newTop: { speed: 21.78, at: 1 } }); // 78.4 km/h
    expect(screen.getByLabelText('New top speed: 78.4 km/h')).toBeTruthy();
    expect(screen.queryByLabelText('Vertical')).toBeNull();
  });

  it('run done: named after the piste when the trail map knows it, and it can be closed', async () => {
    await open({
      ...LIVE,
      lastRun: { number: 3, topSpeed: 21.78, verticalDown: 612, distance: 2400, duration: 252, piste: { name: 'Kandahar', difficulty: 'intermediate', coverage: 0.9 } },
    });
    expect(screen.getByLabelText('Run done. Kandahar, 4:12, 612 m down.')).toBeTruthy();
    expect(screen.getByText('Kandahar')).toBeTruthy();
    expect(screen.getByText('Intermediate piste · 2.4 km')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Close')); });
    expect(mockDismissRun).toHaveBeenCalled();
  });

  it('a paused day offers Resume, and says so', async () => {
    await open({ ...LIVE, status: 'paused', currentSpeed: 0 });
    expect(screen.getByLabelText('Paused')).toBeTruthy();
    expect(screen.getByLabelText('Resume')).toBeTruthy();
    expect(screen.queryByLabelText('Pause')).toBeNull();
  });
});
