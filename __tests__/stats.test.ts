import { distance, simplify } from '../src/lib/geo';
import { cleanTrack, computeStats, runStops, trendLegs, uncacheAltitude } from '../src/lib/stats';
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

  it('drops fixes without a usable time', () => {
    const out = cleanTrack([p(NaN, 47), p(Infinity, 47), p(1000, 47), p(2000, 47.00001)]);
    expect(out.map((x) => x.t)).toEqual([1000, 2000]);
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

  it('two wrong fixes a minute apart while standing still are not a new level', () => {
    // Waiting at the bottom, the phone logs little; twice it reports a stuck value 100 m too high.
    const at = (t: number, alt: number): TrackPoint => ({ t: t * 1000, lat: 47, lon: 10, alt, acc: 5, spd: 0 });
    const pts = [...Array.from({ length: 30 }, (_, t) => at(t, 2000)), at(30, 2100), at(100, 2101)];
    for (let t = 101; t <= 160; t++) pts.push(at(t, 2000));
    const out = cleanTrack(pts);
    expect(out[30].alt).toBeNull();
    expect(out[31].alt).toBeNull();
    expect(out.slice(32).every((p) => p.alt === 2000)).toBe(true);
  });

  it('a few wrong fixes, then fixes in line with the level before them: the wrong ones stay out', () => {
    // Skiing straight down at 8 m/s; the altitude reads 100 m low for 3 s, then is unknown for 18 s.
    const pts: TrackPoint[] = [];
    for (let k = 0; k <= 200; k++) {
      const alt = k >= 100 && k <= 102 ? 1900 - 2 * k : k > 102 && k <= 120 ? null : 2000 - 2 * k;
      pts.push({ t: k * 1000, lat: 47 + (8 * k) / 111195, lon: 10, alt, acc: 5, spd: 8 });
    }
    const out = cleanTrack(pts);
    expect(out.slice(100, 103).map((p) => p.alt)).toEqual([null, null, null]);
    expect(out.slice(121).every((p, k) => p.alt === 2000 - 2 * (121 + k))).toBe(true);
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

  it('altitude freezing on a lift, then jumping down, is not a run', () => {
    // Seen on real phones: altitude stuck at one value for ~70 s while the gondola climbs, then 100 m lower.
    const alt = (k: number) => (k < 200 ? 1300 + 1.5 * k : k < 270 ? 1600 : 1300 + 1.5 * k - 205);
    const s = computeStats(track((k) => ({ x: 0, y: 5 * k, alt: alt(k), spd: 5 + Math.sin(k) * 0.2 }), 500));
    expect(s.runCount).toBe(0);
    expect(s.liftCount).toBe(1);
  });

  it('altitude stuck at a wrong value while skiing, then back, adds no fake vertical', () => {
    // Seen on a real phone: mid-run the altitude reads exactly 763.9 for 80 s (1,100 m too low) while moving at 40 km/h.
    const turning = (k: number) => ({
      x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2000 - 2 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
    });
    const s = computeStats(track((k) => ({ ...turning(k), alt: k >= 100 && k < 180 ? 763.9 : turning(k).alt }), 300));
    expect(s.runCount).toBe(1);
    expect(s.verticalDown).toBeGreaterThan(540);
    expect(s.verticalDown).toBeLessThan(660);
  });

  it('altitude stuck at one wrong value, then straight away at another, adds no fake climb', () => {
    // Seen on a real phone: off a lift, 2 minutes without fixes, then skiing with the altitude stuck 90 m too low
    // for 30 s and then 35 m too high for a minute. The second stuck value was trusted as where it got stuck.
    const lift = (k: number) => ({ x: 0, y: 4 * k, alt: 2000 + 2 * k, spd: 4 });
    const run = (k: number) => ({ ...turning(k), y: 1200 + turning(k).y, alt: 2600 - 2 * k });
    const move = (k: number) => (k < 300 ? lift(k) : k < 420 ? { ...lift(300), spd: 0 } : run(k - 420));
    const pts = track(move, 620)
      .filter((p) => p.t <= 330000 || p.t >= 450000)
      .map((p) => (p.t >= 450000 && p.t < 480000 ? { ...p, alt: 2510.3 } : p.t >= 480000 && p.t < 540000 ? { ...p, alt: 2635.7 } : p));
    const s = computeStats(pts);
    expect(s.liftCount).toBe(1);
    expect(s.runCount).toBe(1);
    expect(s.activities.some((a) => a.kind === 'tour')).toBe(false);
    expect(s.activities.find((a) => a.kind === 'lift')!.endTime).toBeLessThan(340000);
  });

  it('one wild altitude fix while standing still (sparse fixes) is ignored', () => {
    // Waiting 2 minutes halfway down, the phone logs a fix every 20 s; one of them reads 300 m too high.
    const turning = (k: number) => ({
      x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2000 - 2 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
    });
    const all = track((k) => (k < 150 ? turning(k) : k < 270 ? { ...turning(150), spd: 0 } : turning(k - 120)), 420);
    const pts = all.filter((_, i) => i < 180 || i >= 300 || i % 20 === 0);
    const j = pts.findIndex((p) => p.t >= 220000);
    pts[j] = { ...pts[j], alt: (pts[j].alt as number) + 300 };
    const s = computeStats(pts);
    expect(s.runCount).toBe(1);
    expect(s.verticalDown).toBeLessThan(620);
  });

  it('a 2-minute wait halfway down shows as a stop and is left out of the average speed', () => {
    const turning = (k: number) => ({
      x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2400 - 2.5 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
    });
    const s = computeStats(track((k) => (k < 80 ? turning(k) : k < 200 ? { ...turning(80), spd: 0 } : turning(k - 120)), 280));
    const run = s.activities.find((a) => a.kind === 'run')!;
    expect(s.runCount).toBe(1);
    expect(run.stops).toBe(1);
    expect(run.stopTime).toBeGreaterThan(100);
    expect(run.avgSpeed).toBeCloseTo(run.distance / (run.duration - run.stopTime!), 5);
    expect(run.avgSpeed).toBeGreaterThan(run.distance / run.duration * 1.5);
  });

  it('a run, a 10-minute wait at the bottom (no fixes) and a skate to the lift: the run is kept, without the wait', () => {
    const turning = (k: number) => ({
      x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2000 - 2 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
    });
    const end = turning(150);
    const move = (k: number) =>
      k <= 150 ? turning(k)
        : k < 750 ? { ...end, spd: 0 }
          : k < 780 ? { x: end.x, y: end.y + 3 * (k - 750), alt: end.alt - 0.3 * (k - 750), spd: 3 }
            : { x: end.x, y: end.y + 90 + 4 * (k - 780), alt: end.alt - 9 + 2 * (k - 780), spd: 4 };
    // The phone logs nothing while you stand still.
    const pts = track(move, 1080).filter((p) => p.t <= 181000 || p.t >= 780000);
    const s = computeStats(pts);
    expect(s.runCount).toBe(1);
    expect(s.liftCount).toBe(1);
    // The wait isn't ski time.
    expect(s.activities.find((a) => a.kind === 'run')!.duration).toBeLessThan(200);
  });

  it('lunch at the top of a lift is not lift time', () => {
    const move = (k: number) =>
      k < 300 ? { x: 0, y: 4 * k, alt: 2000 + 2 * k, spd: 4 }
        : k < 2700 ? { x: 3 * Math.sin(k / 7), y: 1200, alt: 2600, spd: 1.5 } // wandering about the hut
          : { x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 1200 + 5 * (k - 2700), alt: 2600 - 2 * (k - 2700), spd: 8 };
    const pts = track(move, 2900).filter((p) => p.t < 335000 || p.t >= 2725000 || p.t % 60000 === 0);
    const s = computeStats(pts);
    expect(s.liftCount).toBe(1);
    expect(s.runCount).toBe(1);
    expect(s.activities.find((a) => a.kind === 'lift')!.duration).toBeLessThan(400);
  });

  it('one wild altitude fix after a minute without fixes adds no fake lift or vertical', () => {
    // Seen on a real phone: standing 70 s mid-run (nothing logged), then one fix 450 m low,
    // then 20 s of skiing with no usable altitude. Over 70 s, 450 m isn't too fast, but it is too steep.
    const turning = (k: number) => ({
      x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2000 - 2 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
    });
    const move = (k: number) => (k < 150 ? turning(k) : k < 220 ? { ...turning(150), spd: 0 } : turning(k - 70));
    const spike = 30 + 220; // index = seconds: the track starts with 30 s standing
    const pts = track(move, 370)
      .filter((_, i) => i <= 30 + 150 || i >= spike)
      .map((p) => (p.t === spike * 1000 ? { ...p, alt: (p.alt as number) - 450 } : p.t > spike * 1000 && p.t <= (spike + 20) * 1000 ? { ...p, alt: null } : p));
    const s = computeStats(pts);
    expect(s.runCount).toBe(1);
    expect(s.liftCount).toBe(0);
    expect(s.verticalDown).toBeLessThan(640); // 600 m real
  });

  it('the run ends where you stop, even when the lowest altitude reading comes earlier on the flat', () => {
    // Down the piste, 45 s skating along the flat valley floor (the altitude reads a few metres higher by the end),
    // 15 minutes standing at the lift with a fix a minute, then the lift.
    const turning = (k: number) => ({
      x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2000 - 2 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
    });
    const bottom = turning(150);
    const move = (k: number) =>
      k <= 150 ? turning(k)
        : k <= 195 ? { x: bottom.x, y: bottom.y + 10 * (k - 150), alt: bottom.alt + 0.25 * (k - 150), spd: 10 }
          : k < 1095 ? { x: bottom.x, y: bottom.y + 450, alt: bottom.alt + 11, spd: 0 }
            : { x: bottom.x + 4 * (k - 1095), y: bottom.y + 450, alt: bottom.alt + 11 + 2 * (k - 1095), spd: 4 };
    const pts = track(move, 1400).filter((p) => p.t <= 226000 || p.t >= 1125000 || p.t % 60000 === 0);
    const s = computeStats(pts);
    expect(s.runCount).toBe(1);
    expect(s.liftCount).toBe(1);
    const run = s.activities.find((a) => a.kind === 'run')!;
    expect(run.endTime).toBeGreaterThanOrEqual(220000); // the skate ends at 225 s
    expect(s.activities.find((a) => a.kind === 'lift')!.startTime).toBeGreaterThanOrEqual(1120000);
  });

  it('a short "lift" between two stops partway down is altitude noise, not a lift', () => {
    // Stop a minute, the altitude reads 60 m higher over 40 s of skiing on, stop 30 s, ski on.
    const turning = (k: number) => ({
      x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2000 - 2 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
    });
    const stop = turning(150);
    const move = (k: number) =>
      k <= 150 ? turning(k)
        : k < 210 ? { ...stop, spd: 0 }
          : k < 250 ? { x: stop.x, y: stop.y + 4 * (k - 210), alt: stop.alt + 1.5 * (k - 210), spd: 4 }
            : k < 280 ? { x: stop.x, y: stop.y + 160, alt: stop.alt + 60, spd: 0 }
              : { ...turning(k - 130), y: turning(k - 130).y + 160 };
    const s = computeStats(track(move, 430));
    expect(s.liftCount).toBe(0);
    expect(s.runCount).toBe(1);
  });

  it('a T-bar on gentle ground is a lift, not a climb', () => {
    // 2 m/s along, only 0.25 m/s up: like the slow lifts at Grandvalira.
    const s = computeStats(track((k) => ({ x: 0, y: 2 * k, alt: 2000 + 0.25 * k, spd: 2 + Math.sin(k) * 0.1 }), 600));
    expect(s.liftCount).toBe(1);
    expect(s.activities.some((a) => a.kind === 'tour')).toBe(false);
  });

  it('skinning uphill stays a climb', () => {
    const s = computeStats(track((k) => ({ x: 0, y: 1.05 * k, alt: 2000 + 0.15 * k, spd: 1.05 + Math.sin(k) * 0.1 }), 900));
    expect(s.liftCount).toBe(0);
    expect(s.activities.some((a) => a.kind === 'tour')).toBe(true);
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

  // Down a piste at 2 m/s vertical, turning.
  const turning = (k: number) => ({
    x: 15 * Math.sin((2 * Math.PI * k) / 8), y: 5 * k, alt: 2000 - 2 * k, spd: 7 + 2 * Math.cos((2 * Math.PI * k) / 4),
  });

  it('standing 15 minutes at the lift is a break, not a lift line; 5 minutes is a lift line', () => {
    // Seen on a real day: 16 minutes in the valley before the gondola showed as a lift line.
    const day = (wait: number) => {
      const end = turning(150);
      return computeStats(track((k) =>
        k <= 150 ? turning(k)
          : k < 150 + wait ? { ...end, spd: 0 }
            : { x: end.x, y: end.y + 4 * (k - 150 - wait), alt: end.alt + 2 * (k - 150 - wait), spd: 4 }, 150 + wait + 300));
    };
    const lift = (s: ReturnType<typeof computeStats>) => s.activities.find((a) => a.kind === 'lift')!;
    expect(lift(day(15 * 60)).wait).toBe(0);
    expect(lift(day(5 * 60)).wait).toBeGreaterThan(280);
  });

  it('a 16-minute stop at the top between two lifts in a line, altitude unknown meanwhile, is two lifts', () => {
    // Seen on a real day: off one gondola, 16 minutes at the station (the phone logs no altitude), on the next one
    // in the same direction. Filling the gap in time put 50 m of climbing into the stop, and the stop didn't split the climb.
    const move = (k: number) =>
      k < 250 ? { x: 0, y: 5 * k, alt: 2000 + 2 * k, spd: 5 }
        : k < 1210 ? { x: 0, y: 1250, alt: 2500, spd: 0 }
          : { x: 0, y: 1250 + 5 * (k - 1210), alt: 2500 + (k - 1210), spd: 5 };
    const pts = track(move, 1460).map((p) => (p.t > 280000 && p.t < 1300000 ? { ...p, alt: null } : p));
    const s = computeStats(pts);
    expect(s.liftCount).toBe(2);
    const [l1, l2] = s.activities.filter((a) => a.kind === 'lift');
    expect(l2.startTime - l1.endTime).toBeGreaterThan(900000);
    expect(s.liftTime).toBeLessThan(560);
  });

  it('two lifts taken one after another are two lifts; a chair that stops, or a draglift that bends, is one', () => {
    const r = (40 * Math.PI) / 180;
    // Off a chair heading north, 45 s walking 20 m to a second chair heading 40° off to the right.
    const change = (k: number) =>
      k < 300 ? { x: 0, y: 4 * k, alt: 2000 + 2 * k, spd: 4 }
        : k < 345 ? { x: (20 * (k - 300)) / 45, y: 1200, alt: 2600, spd: 0.5 }
          : { x: 20 + 4 * Math.sin(r) * (k - 345), y: 1200 + 4 * Math.cos(r) * (k - 345), alt: 2600 + 1.5 * (k - 345), spd: 4 };
    expect(computeStats(track(change, 600)).liftCount).toBe(2);
    // Off a gondola, a minute's walk on along the same line and 5 minutes' queue for the next one.
    const walkOn = (k: number) =>
      k < 300 ? { x: 0, y: 4 * k, alt: 2000 + 2 * k, spd: 4 }
        : k < 360 ? { x: 0, y: 1200 + (k - 300), alt: 2600, spd: 1 }
          : k < 660 ? { x: 0, y: 1260, alt: 2600, spd: 0 }
            : { x: 0, y: 1260 + 4 * (k - 660), alt: 2600 + 1.5 * (k - 660), spd: 4 };
    expect(computeStats(track(walkOn, 900)).liftCount).toBe(2);
    // A chair that stands still for 2 minutes halfway up.
    const halt = (k: number) =>
      k < 150 ? { x: 0, y: 4 * k, alt: 2000 + 2 * k, spd: 4 }
        : k < 270 ? { x: 0, y: 600, alt: 2300, spd: 0 }
          : { x: 0, y: 600 + 4 * (k - 270), alt: 2300 + 2 * (k - 270), spd: 4 };
    expect(computeStats(track(halt, 420)).liftCount).toBe(1);
    // A draglift that bends 40° at full speed.
    const bend = (k: number) =>
      k < 150 ? { x: 0, y: 3 * k, alt: 2000 + k, spd: 3 }
        : { x: 3 * Math.sin(r) * (k - 150), y: 450 + 3 * Math.cos(r) * (k - 150), alt: 2000 + k, spd: 3 };
    expect(computeStats(track(bend, 300)).liftCount).toBe(1);
  });

  it('a run starts with the traverse off the lift, not after a short stop that follows it', () => {
    // Seen on a real day: off the lift, a minute's traverse dropping 12 m, a 36 s stop, then the run proper.
    // The traverse was cut off (too little drop before the stop) and the run started 2.5 minutes late.
    const top = { x: 0, y: 1200, alt: 2600 };
    const move = (k: number) =>
      k < 300 ? { x: 0, y: 4 * k, alt: 2000 + 2 * k, spd: 4 }
        : k < 365 ? { x: 4 * (k - 300), y: top.y, alt: top.alt - (12 * (k - 300)) / 65, spd: 4 }
          : k < 401 ? { x: 260, y: top.y, alt: top.alt - 12, spd: 0 }
            : { ...turning(k - 401), x: 260 + turning(k - 401).x, y: top.y + turning(k - 401).y, alt: top.alt - 12 - 2 * (k - 401) };
    const s = computeStats(track(move, 550));
    const run = s.activities.find((a) => a.kind === 'run')!;
    expect(s.runCount).toBe(1);
    expect(run.startTime).toBeLessThan((30 + 320) * 1000); // the traverse starts at 330 s (30 s standing first)
  });
});

describe('cached altitudes', () => {
  it('a cached station altitude is kept at its station, and dropped where it comes back elsewhere', () => {
    // Seen on a real phone: the altitude of one lift station, to the micrometre, comes back all day. Standing at that
    // station it's right (it agrees with the real readings there); halfway down a run it's a cached value, stuck for
    // half a minute, with a made-up low-accuracy fix where it lets go.
    const C = 2600.300049;
    const pts: TrackPoint[] = [], station: number[] = [], far: number[] = [], fillers: number[] = [];
    let t = 0;
    const at = (y: number, x: number, alt: number, spd: number, acc = 5) =>
      pts.push({ t: (t += 1000), lat: 47 + y / 111195, lon: 10 + x / 75800, alt, acc, spd }) - 1;
    for (let lap = 0; lap < 5; lap++) {
      for (let k = 0; k < 300; k++) at(4 * k, 0, 2000 + 2 * k + Math.sin(t) * 0.5, 4); // up the lift
      for (let k = 0; k < 120; k++) {
        if (k % 10 === 0) at(1200, 0, 2600 + Math.sin(t) * 0.5, 0); // the odd real reading at the top station
        else station.push(at(1200, 0, C, 0));
      }
      for (let k = 0; k < 300; k++) { // down the run, curving out and back to the lift
        const y = 1200 - 4 * k, x = 300 * Math.sin((Math.PI * k) / 300), alt = 2600 - 2 * k + Math.sin(t) * 0.5;
        if (k >= 140 && k < 170) far.push(at(y, x, C, 5));
        else if (k === 170) fillers.push(at(y, x, alt + 40, 5, 21));
        else at(y, x, alt, 5);
      }
    }
    const own = uncacheAltitude(pts);
    expect(station.every((i) => own[i].alt === C)).toBe(true);
    expect(far.every((i) => own[i].alt == null)).toBe(true);
    const out = cleanTrack(pts);
    expect(station.every((i) => out[i].alt === C)).toBe(true);
    expect(far.every((i) => out[i].alt == null)).toBe(true);
    expect(fillers.every((i) => out[i].alt == null)).toBe(true);
  });

  it('altitudes rounded to the metre that recur by chance are kept', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const pts = simulateDay({ seed, runs: 6, gpsAltNoise: 3 }).points.map((p) => ({ ...p, alt: Math.round(p.alt as number) }));
      expect(uncacheAltitude(pts).filter((p) => p.alt == null)).toHaveLength(0);
    }
  });
});

describe('stops partway down a run', () => {
  // One fix a second; speed in m/s per fix.
  const track = (spd: number[]) => ({ pts: spd.map((_, i) => ({ t: i * 1000, lat: 0, lon: 0, alt: 0, acc: 5, spd: null })), spd });
  const run = (...parts: [number, number][]) => parts.flatMap(([n, v]) => Array<number>(n).fill(v));

  it('counts a wait for friends, ignoring a short shuffle and a brief pause', () => {
    const { pts, spd } = track(run([60, 10], [100, 0], [3, 2], [80, 0], [60, 10], [15, 0], [60, 10]));
    expect(runStops(pts, spd, 0, pts.length - 1)).toEqual({ stops: 1, stopTime: 182 });
  });

  it('no stops on a run skied straight down', () => {
    const { pts, spd } = track(run([200, 10]));
    expect(runStops(pts, spd, 0, pts.length - 1)).toEqual({ stops: 0, stopTime: 0 });
  });

  it('losing signal while skiing (a tunnel) is not a stop', () => {
    // 200 fixes at 10 m/s heading north, then a minute without fixes, still skiing.
    const pts = Array.from({ length: 200 }, (_, i) => ({
      t: (i < 100 ? i : i + 60) * 1000, lat: 47 + ((i < 100 ? i : i + 60) * 10) / 111195, lon: 10, alt: 0, acc: 5, spd: 10,
    }));
    expect(runStops(pts, pts.map(() => 10), 0, pts.length - 1)).toEqual({ stops: 0, stopTime: 0 });
  });

  it('a signal gap while standing still is still a stop', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ t: (i < 50 ? i : i + 120) * 1000, lat: 47, lon: 10, alt: 0, acc: 5, spd: null }));
    expect(runStops(pts, pts.map((_, i) => (i === 50 ? 0.5 : 10)), 0, pts.length - 1).stops).toBe(1);
  });
});
