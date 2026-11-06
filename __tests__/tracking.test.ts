import { altitudeToPressure, fuseAltitude, hasBarometer, pressureToAltitude } from '../src/lib/altitude';
import { batteryHoursLeft, decideGpsMode, notificationBody, restingFor, type GpsMode } from '../src/lib/power';
import { simulateDay } from '../src/lib/sim';
import { cleanTrack, completedRuns, computeStats } from '../src/lib/stats';
import type { TrackPoint } from '../src/lib/types';

describe('barometric altitude', () => {
  it('converts pressure and altitude both ways', () => {
    expect(pressureToAltitude(1013.25)).toBeCloseTo(0, 5);
    expect(pressureToAltitude(altitudeToPressure(2400))).toBeCloseTo(2400, 3);
    // ~8 m per hPa near sea level, ~10 m per hPa at ski altitude
    expect(pressureToAltitude(1012.25)).toBeGreaterThan(7.5);
  });

  it('only kicks in with enough barometer readings', () => {
    const plain = simulateDay({ runs: 1 }).points;
    expect(hasBarometer(plain)).toBe(false);
    expect(fuseAltitude(plain)).toBe(plain);
    expect(hasBarometer(simulateDay({ runs: 1, barometer: true }).points)).toBe(true);
  });

  it('gets vertical right with noisy GPS altitude, and with the barometer despite weather drift', () => {
    // Very noisy GPS altitude (±15 m), as on many phones.
    const gpsOnly = simulateDay({ gpsAltNoise: 15, seed: 5 });
    const withBaro = simulateDay({ gpsAltNoise: 15, seed: 5, barometer: true });
    const truth = gpsOnly.truth.totalDrop;
    const errGps = Math.abs(computeStats(gpsOnly.points).verticalDown - truth);
    const errBaro = Math.abs(computeStats(withBaro.points).verticalDown - truth);
    expect(errBaro).toBeLessThan(truth * 0.03);
    // The running median takes GPS altitude noise out too.
    expect(errGps).toBeLessThan(truth * 0.03);
    expect(computeStats(gpsOnly.points).runCount).toBe(4);
    expect(computeStats(withBaro.points).runCount).toBe(4);
  });

  it('keeps absolute altitude level with GPS', () => {
    const day = simulateDay({ barometer: true });
    const fused = fuseAltitude(cleanTrack(day.points));
    const top = Math.max(...fused.map((p) => p.alt as number));
    expect(top).toBeGreaterThan(2400);
    expect(top).toBeLessThan(2440);
  });
});

describe('battery saver GPS mode', () => {
  const series = (n: number, f: (i: number) => Partial<TrackPoint>): TrackPoint[] =>
    Array.from({ length: n }, (_, i) => ({ t: i * 1000, lat: 47, lon: 10, alt: 2000, acc: 5, spd: 0, ...f(i) }));

  it('goes eco when standing still', () => {
    expect(decideGpsMode(series(50, () => ({})), 'precise')).toBe('eco');
  });

  it('goes eco on a lift and precise as soon as you ski', () => {
    // 4 m/s north, climbing 1.2 m/s: a chairlift
    const lift = series(50, (i) => ({ lat: 47 + (i * 4) / 111195, alt: 1800 + i * 1.2, spd: 4 }));
    expect(decideGpsMode(lift, 'precise')).toBe('eco');
    // 12 m/s downhill
    const ski = series(50, (i) => ({ lat: 47 + (i * 12) / 111195, alt: 2400 - i * 3, spd: 12 }));
    expect(decideGpsMode(ski, 'eco')).toBe('precise');
  });

  it('uses real days sensibly: mostly eco time is lifts and breaks', () => {
    const day = simulateDay();
    const pts = day.points;
    let eco = 0, precise = 0, sleep = 0, mode: GpsMode = 'precise';
    // The background task looks at the last 11 minutes of fixes.
    for (let i = 60; i < pts.length; i += 5) {
      mode = decideGpsMode(pts.slice(Math.max(0, i - 660), i), mode);
      if (mode === 'eco') eco++; else if (mode === 'sleep') sleep++; else precise++;
    }
    expect(eco + sleep).toBeGreaterThan(precise); // lunch + lifts dominate a day
    expect(sleep).toBeGreaterThan(0); // the 25-minute lunch auto-pauses
    // Lunch + the lift queue after it is ~29 min standing still; sleep only covers the part after 10 min.
    expect(sleep * 5).toBeLessThan(20 * 60);
  });

  it('auto-pauses after 10 minutes standing still and wakes when you move', () => {
    const still = series(11 * 60, () => ({}));
    expect(restingFor(still)).toBe((11 * 60 - 1) * 1000);
    expect(decideGpsMode(still, 'eco')).toBe('sleep');
    expect(decideGpsMode(still.slice(0, 5 * 60), 'eco')).toBe('eco'); // 5 min: just a stop
    const moved = [...still, { ...still[0], t: 11 * 60 * 1000 + 60000, lat: 47.002, spd: 8 }];
    expect(restingFor(moved)).toBe(0);
    expect(decideGpsMode(moved, 'sleep')).toBe('precise');
  });

  it('estimates hours of battery left', () => {
    expect(batteryHoursLeft(1, 0, 0.99, 600000)).toBeNull(); // too early
    expect(batteryHoursLeft(0.9, 0, 0.8, 3600000)).toBeCloseTo(8, 5); // 10%/h, 80% left
  });

  it('writes a short notification line', () => {
    expect(notificationBody({ runCount: 5, verticalDown: 2450, topSpeed: 20 }, {
      alt: (m) => `${m} m`, speed: (v) => `${v * 3.6} km/h`,
    })).toBe('5 runs · 2450 m ↓ · top 72 km/h');
  });
});

describe('live "run done" moments', () => {
  it('announces each run once, while riding the next lift, never mid-run', () => {
    const day = simulateDay();
    const announced: number[] = []; // index at which the count went up
    let count = 0;
    const steps: number[] = [];
    for (let i = 120; i < day.points.length; i += 60) steps.push(i);
    steps.push(day.points.length);
    for (const i of steps) {
      const n = completedRuns(computeStats(day.points.slice(0, i))).length;
      if (n > count) announced.push(i);
      expect(n).toBeGreaterThanOrEqual(count); // never goes backwards
      count = n;
    }
    expect(count).toBe(4);
    expect(announced).toHaveLength(4);
  });
});
