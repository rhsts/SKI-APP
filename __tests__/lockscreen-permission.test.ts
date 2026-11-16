import { Platform } from 'react-native';

const mockDialog = jest.fn();
jest.mock('../src/dialog', () => ({ dialog: (...a: unknown[]) => mockDialog(...a) }));
jest.mock('../src/db', () => ({ loadSettings: async () => ({ units: 'metric' }) }));
jest.mock(
  'expo-location/next',
  () => ({
    Location: {
      requestNotificationPermissions: async () => ({ granted: false }),
      ensureBackgroundSessionStarted: async () => undefined,
    },
  }),
  { virtual: true },
);

import { startTrackingService } from '../src/tracking/lockscreen';

const active = { sessionId: 1, startedAt: Date.now(), paused: false, source: 'gps' } as never;

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { get: () => 'android' });
});

test('blocked notifications: recording still starts, the app says why the lock screen stays empty, once', async () => {
  expect(await startTrackingService(active, null)).toBe(true);
  expect(await startTrackingService(active, null)).toBe(true);
  expect(mockDialog).toHaveBeenCalledTimes(1);
  expect(mockDialog.mock.calls[0][0]).toBe('Notifications are off');
});
