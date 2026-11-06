import { distance, simplify } from '../src/lib/geo';
import { cleanTrack, computeStats, trendLegs } from '../src/lib/stats';
import { statsForSport } from '../src/lib/stats';
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

  it('on a normal ski day, slow climbs are lifts, not skinning', () => {
    const s = computeStats(simulateDay({ touring: true, runs: 2 }).points);
    const ski = statsForSport(s, 'ski');
    expect(ski.activities.filter((a) => a.kind === 'tour')).toHaveLength(0);
    expect(ski.liftCount).toBe(s.liftCount + 2);
    expect(ski.tourVertical).toBe(0);
    expect(ski.activities).toHaveLength(s.activities.length);
    expect(statsForSport(s, 'touring')).toBe(s);
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

describe('altitude glitches that hold a while', () => {
  const base = simulateDay().points;
  const good = computeStats(base);

  it('a single bad first fix 300 m up adds no vertical', () => {
    const pts = base.map((p, i) => (i === 0 ? { ...p, alt: p.alt! + 300 } : p));
    const s = computeStats(pts);
    expect(Math.abs(s.verticalDown - good.verticalDown)).toBeLessThan(30);
    expect(s.runCount).toBe(good.runCount);
  });

  it('a 20 s glitch 300 m up mid-run adds no run and no vertical', () => {
    const run = good.activities.find((a) => a.kind === 'run')!;
    const from = Math.round((run.startIndex + run.endIndex) / 2);
    const pts = base.map((p, i) => (i >= from && i < from + 20 ? { ...p, alt: p.alt! + 300 } : p));
    const s = computeStats(pts);
    expect(s.runCount).toBe(good.runCount);
    expect(s.liftCount).toBe(good.liftCount);
    expect(Math.abs(s.verticalDown - good.verticalDown)).toBeLessThan(30);
  });

  it('a new level that holds a minute is accepted, with its fixes restored', () => {
    const pts: TrackPoint[] = [{ t: 0, lat: 47, lon: 10, alt: 2300, acc: 5, spd: 0 }];
    for (let k = 1; k <= 90; k++) pts.push({ t: k * 1000, lat: 47, lon: 10, alt: 2000 - k, acc: 5, spd: 0 });
    const out = cleanTrack(pts);
    expect(out[0].alt).toBeNull(); // the bad first fix
    expect(out.slice(1).every((p, k) => p.alt === 2000 - (k + 1))).toBe(true);
  });
});

describe('Doppler speed spikes', () => {
  it('ignores a two-fix 38 m/s spike on a lift', () => {
    const pts: TrackPoint[] = [];
    for (let k = 0; k < 200; k++) {
      pts.push({ t: k * 1000, lat: 47 + k * 4.5e-5, lon: 10, alt: 1800 + k * 2, acc: 5, spd: k === 100 || k === 101 ? 38 : 5 });
    }
    expect(computeStats(pts).topSpeed).toBeLessThan(10);
  });
});

describe('riding a lift down', () => {
  // Small seeded GPS position noise (±1 m) so paths aren't unrealistically clean.
  let seed = 7;
  const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2e-5;
  const M = 1 / 111195; // degrees latitude per metre
  const track = (move: (k: number) => { x: number; y: number; alt: number; spd: number }, seconds: number) => {
    const pts: TrackPoint[] = [];
    const at = (k: number, x: number, y: number, alt: number, spd: number) =>
      pts.push({ t: k * 1000, lat: 47 + y * M + jitter(), lon: 10 + (x * M) / Math.cos((47 * Math.PI) / 180) + jitter(), alt, acc: 5, spd });
    const s0 = move(0), end = move(seconds);
    for (let k = 0; k < 30; k++) at(k, s0.x, s0.y, s0.alt, 0);
    for (let k = 0; k <= seconds; k++) { const m = move(k); at(30 + k, m.x, m.y, m.alt, m.spd); }
    for (let k = 1; k <= 30; k++) at(30 + seconds + k, end.x, end.y, end.alt, 0);
    return pts;
  };

  it('a gondola going down at a steady 5 m/s is a lift, not a run', () => {
    const s = computeStats(track((k) => ({ x: 0, y: 5 * k, alt: 2400 - 2.5 * k, spd: 5 + Math.sin(k) * 0.2 }), 160));
    expect(s.runCount).toBe(0);
    expect(s.liftCount).toBe(1);
  });

  it('a normal turning run stays a run', () => {
    const s = computeStats(track((k) => ({
      x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2400 - 2.5 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
    }), 160));
    expect(s.runCount).toBe(1);
    expect(s.liftCount).toBe(0);
  });

  it('a straight schuss at varying speed stays a run', () => {
    let y = 0;
    const s = computeStats(track((k) => {
      const spd = 8 + 5 * Math.sin(k / 10);
      if (k > 0) y += spd;
      return { x: 0, y, alt: 2400 - y / 2, spd };
    }, 120));
    expect(s.runCount).toBe(1);
  });
});
