import { activityAt, indexAtX } from '../src/lib/scrub';
import type { Activity } from '../src/lib/types';

describe('indexAtX (dragging on the elevation graph)', () => {
  const times = [0, 1000, 2000, 10000, 11000]; // uneven: a gap in the middle

  it('clamps to the first and last fix', () => {
    expect(indexAtX(times, -50, 200)).toBe(0);
    expect(indexAtX(times, 0, 200)).toBe(0);
    expect(indexAtX(times, 200, 200)).toBe(4);
    expect(indexAtX(times, 999, 200)).toBe(4);
  });

  it('maps by time, picking the nearest fix', () => {
    expect(indexAtX(times, 100, 200)).toBe(2); // t=5500: 2000 is nearer than 10000
    expect(indexAtX(times, 120, 200)).toBe(3); // t=6600: 10000 is nearer
    expect(indexAtX(times, 9, 200)).toBe(0); // t=495
    expect(indexAtX(times, 11, 200)).toBe(1); // t=605
  });

  it('handles empty, single-point and unmeasured charts', () => {
    expect(indexAtX([], 10, 100)).toBe(-1);
    expect(indexAtX([5], 10, 100)).toBe(0);
    expect(indexAtX(times, 10, 0)).toBe(0);
  });
});

describe('activityAt', () => {
  const a = (kind: Activity['kind'], startIndex: number, endIndex: number) => ({ kind, startIndex, endIndex }) as Activity;
  const acts = [a('lift', 0, 10), a('run', 10, 20), a('other', 20, 25)];
  it('finds what you were doing at a point', () => {
    expect(activityAt(acts, 5)?.kind).toBe('lift');
    expect(activityAt(acts, 15)?.kind).toBe('run');
    expect(activityAt(acts, 99)).toBeNull();
  });
});
