import { compareSplits, pointAlong, progressAt, splitTimes } from '../src/lib/ghost';
import { buildSegmentPath, findAttempts, ghostTimeAt, GHOST_SAMPLES, type Segment } from '../src/lib/segments';
import { decodeChallenge, encodeChallenge } from '../src/lib/share';
import { simulateDay } from '../src/lib/sim';
import { cleanTrack, computeStats } from '../src/lib/stats';
import { suggestChallenges } from '../src/lib/suggest';

const day = simulateDay();
const pts = cleanTrack(day.points);
const stats = computeStats(day.points);
const runIdx = stats.activities.findIndex((a) => a.kind === 'run');
const run = stats.activities[runIdx];
const segment: Segment = {
  id: 's1', name: 'Wall', createdAt: 0, creatorName: null, gateRadius: 30,
  path: buildSegmentPath(pts, run.startIndex, run.endIndex),
};
const attempts = findAttempts(day.points, segment);

describe('ghost on the map', () => {
  const g = attempts[0].ghost;
  it('inverts the ghost: time → progress → time', () => {
    for (const f of [0, 0.1, 0.33, 0.5, 0.9, 1]) expect(progressAt(g, ghostTimeAt(g, f))).toBeCloseTo(f, 3);
    expect(progressAt(g, -5)).toBe(0);
    expect(progressAt(g, 1e9)).toBe(1);
  });

  it('places a point along the course', () => {
    const start = pointAlong(segment.path, 0), end = pointAlong(segment.path, 1);
    expect(start.lat).toBeCloseTo(segment.path[0][0], 6);
    expect(end.lat).toBeCloseTo(segment.path[segment.path.length - 1][0], 6);
    const mid = pointAlong(segment.path, 0.5);
    expect(mid.lat).toBeLessThan(start.lat); // the piste runs south, downhill
    expect(mid.lat).toBeGreaterThan(end.lat);
  });
});

describe('split times', () => {
  it('splits a run into three sections that add up', () => {
    const s = splitTimes(attempts[0].ghost);
    expect(s).toHaveLength(3);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(attempts[0].time, 0);
  });

  it('finds where you lost time against a faster run', () => {
    const c = compareSplits(attempts[0].ghost, attempts[3].ghost); // slowest vs fastest
    expect(c.deltas.every((d) => d >= 0)).toBe(true);
    expect(c.worst).not.toBeNull();
    expect(c.best).toBeNull();
    // A synthetic case: lost all the time in the bottom third.
    const even = Array.from({ length: GHOST_SAMPLES + 1 }, (_, k) => k * 3);
    const slowBottom = even.map((t, k) => (k / GHOST_SAMPLES > 2 / 3 ? t + (k / GHOST_SAMPLES - 2 / 3) * 30 : t));
    expect(compareSplits(slowBottom, even).worst).toBe(2);
  });
});

describe('challenge suggestions', () => {
  it('suggests the run you skied four times, using your fastest one', () => {
    const s = suggestChallenges(pts, stats.activities, []);
    expect(s).toHaveLength(1);
    expect(s[0].times).toBe(4);
    const chosen = stats.activities[s[0].activityIndex];
    const fastest = Math.min(...stats.activities.filter((a) => a.kind === 'run').map((a) => a.duration));
    expect(chosen.duration).toBe(fastest);
  });

  it('stays quiet once that run is already a challenge', () => {
    expect(suggestChallenges(pts, stats.activities, [segment])).toEqual([]);
  });

  it('needs at least two runs on the same line', () => {
    const one = simulateDay({ runs: 1 });
    expect(suggestChallenges(cleanTrack(one.points), computeStats(one.points).activities, [])).toEqual([]);
  });
});

describe('group challenges', () => {
  it('carries up to 20 skiers in one link', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}:${i}`, segmentId: 's1', sessionId: null, playerId: `p${i}`, playerName: `Skier ${i}`,
      time: 100 + i, at: 1000 * (i + 1), ghost: attempts[0].ghost,
    }));
    const back = decodeChallenge(encodeChallenge(segment, many, 'Coach'));
    expect(back.attempts).toHaveLength(20);
    expect(back.attempts[0].playerName).toBe('Skier 0');
  });
});
