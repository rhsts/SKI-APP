/**
 * The Record tab: the idle screen with its one Start control, the live instrument
 * layout, and the moments (new top speed, run done) that appear on top of it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
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
const mockUpdateSettings = jest.fn();
let mockBadges: { id: string; icon: string; title: string; description: string }[] = [];
const mockDialog = jest.fn();

jest.mock('../../src/dialog', () => ({ dialog: (...a: unknown[]) => mockDialog(...a) }));
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
  return { useSettings: () => s, getSettings: () => s, updateSettings: (...a: unknown[]) => mockUpdateSettings(...a) };
});
jest.mock('../../src/db', () => ({ listTrailMaps: jest.fn(async () => []), sessionStarts: jest.fn(async () => []), kvGet: jest.fn(async () => null) }));
jest.mock('../../src/days/badges', () => ({ badgesEarnedBy: jest.fn(async () => mockBadges) }));
jest.mock('../../src/mountain/places', () => ({
  searchPlaces: jest.fn(async () => [{ name: 'Mürren', region: 'Bern, Switzerland', lat: 46.559, lon: 7.892, alt: 1638 }]),
}));
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
// eslint-disable-next-line import/first
import { Setup } from '../../src/components/Setup';

async function open(state: TrackerState) {
  mockState = state;
  await render(<RecordScreen />);
  await act(async () => { await Promise.resolve(); });
}

describe('record screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBadges = [];
  });

  it('idle: one Start control and SOS, no live figures', async () => {
    await open(IDLE);
    expect(screen.getByLabelText(/^Emergency/)).toBeTruthy();
    expect(screen.queryByText('Top speed')).toBeNull();
    // Hours of tracking, never a percentage: 86% at the typical 7% an hour.
    expect(screen.getByText('About 12 h of tracking')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    await act(async () => { fireEvent.press(screen.getByLabelText('Start recording your day')); });
    expect(mockStart).toHaveBeenCalledWith(false, 'ski');
  });

  it('recording: the day’s top speed and heights, never the speed right now', async () => {
    await open(LIVE);
    expect(screen.getByLabelText(/^Top speed: [\d.]+ km\/h$/)).toBeTruthy();
    expect(screen.queryByLabelText('Top speed: 62 km/h')).toBeNull();
    expect(screen.queryByText('Speed')).toBeNull();
    for (const label of ['Highest', 'Lowest', 'Vertical', 'Runs', 'Jumps', 'Falls']) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByLabelText(/^Highest, [\d,]+, m$/)).toBeTruthy();
    expect(screen.getByText('About 13 h of tracking left')).toBeTruthy();
    expect(screen.queryByText(/74%/)).toBeNull();
  });

  it('finishing takes a held press; a tap only asks, in the app’s own dialog', async () => {
    await open(LIVE);
    const finish = screen.getByLabelText('Finish your day');
    await act(async () => { fireEvent.press(finish); });
    expect(mockDialog).toHaveBeenCalledWith('Finish your day?', undefined, expect.any(Array));
    expect(mockStop).not.toHaveBeenCalled();
    await act(async () => { fireEvent(finish, 'longPress'); });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('a new top speed is called out on the big figure', async () => {
    await open({ ...LIVE, newTop: { speed: 21.78, at: 1 } }); // 78.4 km/h
    expect(screen.getByLabelText('New top speed: 78.4 km/h')).toBeTruthy();
    expect(screen.queryByText('Top speed')).toBeNull();
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

  it('search: type a place, pick it, and the page shows that place', async () => {
    await open(IDLE);
    await act(async () => { fireEvent.press(screen.getByLabelText('Find a place')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Place name'), 'Mürren'); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Search')); });
    await act(async () => { fireEvent.press(screen.getByLabelText('Mürren, Bern, Switzerland')); });
    // The heading on the page and the title of the sheet with its snow and map.
    expect(screen.getAllByText('Mürren').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Another place')).toBeTruthy();
  });

  it('new badges show in the app’s own sheet, not a system dialog', async () => {
    mockBadges = [{ id: 'first', icon: 'snow-outline', title: 'First tracks', description: 'Record your first ski day.' }];
    await open(LIVE);
    await act(async () => { fireEvent(screen.getByLabelText('Finish your day'), 'longPress'); });
    expect(screen.getByText('New badge')).toBeTruthy();
    expect(screen.getByText('First tracks')).toBeTruthy();
    expect(mockDialog).not.toHaveBeenCalled();
    // The day opens when the sheet is closed, not behind it.
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByLabelText('See your day')); });
    expect(router.push).toHaveBeenCalledWith('/day/d1');
  });

  it('first open: the setup screen saves that it was answered', async () => {
    await render(<Setup />);
    expect(screen.getByText('Set up Ski Tracker')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Imperial (mph, ft)')); });
    expect(mockUpdateSettings).toHaveBeenCalledWith({ units: 'imperial' });
    await act(async () => { fireEvent.press(screen.getByLabelText('Done')); });
    expect(mockUpdateSettings).toHaveBeenCalledWith({ setupDone: true });
  });

  it('a paused day offers Resume, and says so', async () => {
    await open({ ...LIVE, status: 'paused', currentSpeed: 0 });
    expect(screen.getByLabelText('Paused')).toBeTruthy();
    expect(screen.getByLabelText('Resume')).toBeTruthy();
    expect(screen.queryByLabelText('Pause')).toBeNull();
  });
});
