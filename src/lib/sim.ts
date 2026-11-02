import { localProjector, type LatLon } from './geo';
import type { TrackPoint } from './types';

/**
 * Deterministic fake ski day used by the demo mode and the tests:
 * queue → chairlift up → run down, repeated, with a lunch break.
 * Each run is a little faster than the last.
 */

export interface SimOptions {
  start?: number; // epoch ms of the first fix
  runs?: number;
  seed?: number;
  /** Top speed (m/s) of each run, cycled if shorter than `runs`. */
  runTopSpeeds?: number[];
  /** Leave out Doppler speed so speed has to be derived from positions. */
  noDoppler?: boolean;
  /** Indices of fixes to replace with a wild GPS jump. */
  spikes?: number[];
}

export interface SimDay {
  points: TrackPoint[];
  truth: {
    runs: number;
    lifts: number;
    dropPerRun: number;
    totalDrop: number;
    topSpeed: number;
    runTopSpeeds: number[];
  };
}

export const SIM_ORIGIN: LatLon = { lat: 47.0137, lon: 10.2918 }; // somewhere in the Alps
const BASE_ALT = 1810;
const TOP_ALT = 2420;
const LIFT_SPEED = 4; // m/s along the cable
// Piste waypoints in metres (x east, y north) from the top station down to the base.
const PISTE: [number, number][] = [
  [0, 1900], [180, 1700], [380, 1580], [300, 1300], [80, 1120],
  [220, 860], [420, 700], [330, 430], [120, 260], [60, 90], [0, 0],
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polylineAt(path: [number, number][], cumLen: number[], s: number): [number, number] {
  let i = 1;
  while (i < path.length - 1 && cumLen[i] < s) i++;
  const seg = cumLen[i] - cumLen[i - 1];
  const u = seg > 0 ? Math.min(1, Math.max(0, (s - cumLen[i - 1]) / seg)) : 0;
  return [path[i - 1][0] + u * (path[i][0] - path[i - 1][0]), path[i - 1][1] + u * (path[i][1] - path[i - 1][1])];
}

export function simulateDay(opts: SimOptions = {}): SimDay {
  const rnd = mulberry32(opts.seed ?? 42);
  const noise = (amp: number) => (rnd() + rnd() + rnd() - 1.5) * (amp / 1.5);
  const runCount = opts.runs ?? 4;
  const tops = opts.runTopSpeeds ?? [14, 16, 18, 20.5];
  const { fromXY } = localProjector(SIM_ORIGIN);
  const points: TrackPoint[] = [];
  let t = opts.start ?? Date.UTC(2026, 0, 17, 8, 45);

  const emit = (x: number, y: number, alt: number, spd: number) => {
    const p = fromXY(x + noise(2.5), y + noise(2.5));
    points.push({
      t,
      lat: p.lat,
      lon: p.lon,
      alt: alt + noise(3),
      acc: 4 + rnd() * 4,
      spd: opts.noDoppler ? null : Math.max(0, spd + noise(0.3)),
    });
    t += 1000;
  };
  const wait = (seconds: number, x: number, y: number, alt: number) => {
    for (let k = 0; k < seconds; k++) emit(x, y, alt, 0);
  };

  const pisteLen = [0];
  for (let i = 1; i < PISTE.length; i++) {
    pisteLen.push(pisteLen[i - 1] + Math.hypot(PISTE[i][0] - PISTE[i - 1][0], PISTE[i][1] - PISTE[i - 1][1]));
  }
  const L = pisteLen[pisteLen.length - 1];
  const top = PISTE[0];
  const liftLen = Math.hypot(top[0], top[1]);
  const usedTops: number[] = [];

  for (let r = 0; r < runCount; r++) {
    // Queue at the base, then ride the chairlift straight up.
    wait(60 + Math.round(rnd() * 60), 0, 0, BASE_ALT);
    for (let s = 0; s < liftLen; s += LIFT_SPEED) {
      const u = s / liftLen;
      emit(top[0] * u, top[1] * u, BASE_ALT + (TOP_ALT - BASE_ALT) * u, LIFT_SPEED);
    }
    wait(30 + Math.round(rnd() * 30), top[0], top[1], TOP_ALT);

    // Ski down: accelerate, carve with speed variations, peak on the steep middle section, slow at the bottom.
    const vmax = tops[r % tops.length];
    let runTop = 0;
    let s = 0;
    while (s < L) {
      const u = s / L;
      const envelope = Math.min(1, u * 12, (1 - u) * 10); // ramp in / out
      const carve = 0.85 + 0.15 * Math.sin(u * Math.PI * 14);
      const v = Math.max(2.5, vmax * envelope * carve);
      if (v > runTop) runTop = v;
      const [x, y] = polylineAt(PISTE, pisteLen, s);
      // Smooth, strictly descending altitude profile.
      const f = u + 0.06 * Math.sin(2 * Math.PI * u);
      emit(x, y, TOP_ALT - (TOP_ALT - BASE_ALT) * f, v);
      s += v;
    }
    usedTops.push(runTop);
    if (r === 1) wait(25 * 60, 0, 0, BASE_ALT); // lunch
  }
  wait(90, 0, 0, BASE_ALT);

  for (const i of opts.spikes ?? []) {
    if (i > 0 && i < points.length) {
      const p = points[i];
      const jump = fromXY(4000, -3000);
      points[i] = { ...p, lat: jump.lat, lon: jump.lon, spd: opts.noDoppler ? null : 95 };
    }
  }

  return {
    points,
    truth: {
      runs: runCount,
      lifts: runCount,
      dropPerRun: TOP_ALT - BASE_ALT,
      totalDrop: (TOP_ALT - BASE_ALT) * runCount,
      topSpeed: Math.max(...usedTops),
      runTopSpeeds: usedTops,
    },
  };
}
