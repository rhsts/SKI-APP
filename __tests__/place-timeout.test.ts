jest.mock('expo-location', () => ({ reverseGeocodeAsync: () => new Promise(() => undefined) }));
// eslint-disable-next-line import/first
import { lookupPlace } from '../src/tracking/place';

it('gives up on a place lookup that never answers, so Finish doesn’t hang', async () => {
  jest.useFakeTimers();
  const p = lookupPlace([{ t: 0, lat: 47, lon: 10, alt: 1400, acc: 5, spd: 0 }]);
  jest.advanceTimersByTime(9000);
  await expect(p).resolves.toBeNull();
  jest.useRealTimers();
});
