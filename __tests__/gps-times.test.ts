import { plausibleFixes } from '../src/tracking/task';

jest.mock('expo-location', () => ({ Accuracy: {}, ActivityType: {} }));
jest.mock('expo-task-manager', () => ({ isTaskDefined: () => true, defineTask: jest.fn() }));
jest.mock('../src/db', () => ({}));
jest.mock('../src/tracking/lockscreen', () => ({}));
jest.mock('../src/mountain/pistes', () => ({}));
jest.mock('../src/tracking/barometer', () => ({}));

describe('plausibleFixes', () => {
  const start = 1_700_000_000_000;
  const now = start + 3600_000;
  it('keeps fixes from the day', () => {
    const pts = [{ t: start - 30_000 }, { t: start + 1000 }, { t: now }, { t: now + 60_000 }];
    expect(plausibleFixes(pts, start, now)).toEqual(pts);
  });
  it('drops a cached fix from before Start, a fix from the future and a broken time', () => {
    const pts = [{ t: start - 2 * 3600_000 }, { t: start + 1000 }, { t: now + 365 * 86400_000 }, { t: NaN }];
    expect(plausibleFixes(pts, start, now)).toEqual([{ t: start + 1000 }]);
  });
});
