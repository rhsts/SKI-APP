import { distance, simplify } from '../src/lib/geo';
import { cleanTrack, computeStats, trendLegs } from '../src/lib/stats';
import { simulateDay } from '../src/lib/sim';
import type { TrackPoint } from '../src/lib/types';

describe('geo', () => {
  it('measures one degree of latitude as ~111.2 km', () => {
    expect(distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111195, -1);
  });

  it('measures a known city pair (Innsbruck → Salzburg ≈ 151 km)', () => {
    const d = distance({ lat: 47.2692, lon: 11.4041 }, { lat: 47.8095, lon: 13.055 });
    expect(d / 1000).toBeGreaterThan(135);
    expect(d / 1000).toBeLessThan(140);
  });

  it('simplifies a straight line to its endpoints', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ lat: 47 + i * 1e-4, lon: 10 }));
    expect(simplify(line, 1)).toEqual([0, 49]);
  });
});

describe('cleanTrack', () => {
  const p = (t: number, lat: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({
    t, lat, lon: 10, alt: 2000, acc: 5, spd: null, ...extra,
  });

  it('drops inaccurate fixes, duplicates and teleports', () => {
    const pts = [
      p(0, 47),
      p(0, 47.00001), // duplicate time
      p(1000, 47.00005, { acc: 120 }), // inaccurate
      p(2000, 47.5), // 55 km in a second
      p(3000, 47.0001),
    ];
    expect(cleanTrack(pts).map((x) => x.t)).toEqual([0, 3000]);
  });

  it('resyncs when the first fix was the bad one', () => {
    const pts = [p(0, 46), ...Array.from({ length: 10 }, (_, i) => p((i + 1) * 1000, 47 + i * 1e-5))];
    const out = cleanTrack(pts);
    expect(out.length).toBeGreaterThanOrEqual(5);
    expect(out[out.length - 1].lat).toBeCloseTo(47 + 9e-5, 6);
  });
});

describe('trendLegs', () => {
  it('ignores bumps smaller than the threshold', () => {
    const alts = [2000, 1990, 1995, 1970, 1975, 1940, 1960, 1990, 2010, 2040];
    const legs = trendLegs(alts);
    expect(legs.map((l) => l.dir)).toEqual([-1, 1]);
    expect(legs[0].end).toBe(5);
  });
});

describe('computeStats on a simulated day', () => {
  const sim = simulateDay();
  const stats = computeStats(sim.points);

  it('finds every run and lift', () => {
    expect(stats.runCount).toBe(sim.truth.runs);
    expect(stats.liftCount).toBe(sim.truth.lifts);
  });

  it('alternates lift and run', () => {
    const seq = stats.activities.filter((a) => a.kind !== 'other').map((a) => a.kind);
    expect(seq).toEqual(['lift', 'run', 'lift', 'run', 'lift', 'run', 'lift', 'run']);
  });

  it('measures vertical within 5%', () => {
    expect(stats.verticalDown).toBeGreaterThan(sim.truth.totalDrop * 0.95);
    expect(stats.verticalDown).toBeLessThan(sim.truth.totalDrop * 1.05);
    for (const run of stats.activities.filter((a) => a.kind === 'run')) {
      expect(run.verticalDown).toBeGreaterThan(sim.truth.dropPerRun * 0.9);
    }
  });

  it('reports the top speed of the fastest run', () => {
    expect(stats.topSpeed).toBeGreaterThan(sim.truth.topSpeed - 0.6);
    expect(stats.topSpeed).toBeLessThan(sim.truth.topSpeed + 0.6);
    const runTops = stats.activities.filter((a) => a.kind === 'run').map((r) => r.topSpeed);
    runTops.forEach((v, i) => expect(Math.abs(v - sim.truth.runTopSpeeds[i])).toBeLessThan(0.8));
  });

  it('splits time into skiing, lifts and the lunch break', () => {
    expect(stats.skiTime).toBeGreaterThan(4 * 120);
    expect(stats.liftTime).toBeGreaterThan(4 * 400);
    expect(stats.duration).toBeGreaterThan(stats.skiTime + stats.liftTime + 20 * 60);
    expect(stats.maxAlt).toBeGreaterThan(2400);
    expect(stats.minAlt).toBeLessThan(1830);
  });

  it('ignores GPS spikes when positions are the only speed source', () => {
    const spiky = simulateDay({ noDoppler: true, spikes: [900, 2400, 4100] });
    const s = computeStats(spiky.points);
    expect(s.runCount).toBe(spiky.truth.runs);
    expect(s.topSpeed).toBeLessThan(spiky.truth.topSpeed + 2);
    expect(s.topSpeed).toBeGreaterThan(spiky.truth.topSpeed - 2.5);
  });

  it('handles an empty or altitude-less track', () => {
    expect(computeStats([]).runCount).toBe(0);
    const flat = sim.points.slice(0, 200).map((p) => ({ ...p, alt: null }));
    const s = computeStats(flat);
    expect(s.runCount).toBe(0);
    expect(s.verticalDown).toBe(0);
    expect(s.distance).toBeGreaterThan(0);
  });
});

describe('lift lines and ski touring', () => {
  it('measures time in the lift line, but not the lunch break', () => {
    const sim = simulateDay();
    const s = computeStats(sim.points);
    const lifts = s.activities.filter((a) => a.kind === 'lift');
    // Queues are 60–120 s in the simulator (plus slowing to a stop at the bottom);
    // the lift after the 25-minute lunch is a break, not a queue.
    expect(lifts[0].wait).toBeGreaterThanOrEqual(55);
    expect(lifts[2].wait).toBe(0);
    expect(s.liftWaitTime).toBeGreaterThan(3 * 55);
    expect(s.liftWaitTime).toBeLessThan(3 * 200);
  });

  it('recognises climbing on skins as touring, not a lift', () => {
    const sim = simulateDay({ touring: true, runs: 2 });
    const s = computeStats(sim.points);
    expect(s.liftCount).toBe(0);
    expect(s.activities.filter((a) => a.kind === 'tour')).toHaveLength(2);
    expect(s.tourVertical).toBeGreaterThan(2 * 550);
    expect(s.runCount).toBe(2);
  });
});
