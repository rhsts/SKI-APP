import { altitudeToPressure } from './altitude';
import { localProjector, type LatLon } from './geo';
import type { MotionEvent } from './motion';
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
  /** Add barometer readings (true altitude + weather drift + sensor noise). */
  barometer?: boolean;
  /** Ski touring: climb on skins along a zig-zag skin track instead of taking the lift. */
  touring?: boolean;
  /** GPS altitude noise amplitude in metres (default 3). */
  gpsAltNoise?: number;
  /** Indices of fixes to replace with a wild GPS jump. */
  spikes?: number[];
  /** Ski in big S-turns down the piste instead of straight along it. */
  turns?: boolean;
}

export interface SimDay {
  points: TrackPoint[];
  /** Fake jumps (a few per run) and one fall, as the accelerometer would report them. */
  motion: MotionEvent[];
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
  const t0 = t;
  const altNoise = opts.gpsAltNoise ?? 3;

  const emit = (x: number, y: number, alt: number, spd: number) => {
    const p = fromXY(x + noise(2.5), y + noise(2.5));
    points.push({
      t,
      lat: p.lat,
      lon: p.lon,
      alt: alt + noise(altNoise),
      acc: 4 + rnd() * 4,
      spd: opts.noDoppler ? null : Math.max(0, spd + noise(0.3)),
      // Weather: pressure falls ~0.8 hPa per hour (≈ 7 m of fake climb per hour) + sensor noise.
      ...(opts.barometer
        ? { pres: altitudeToPressure(alt) - ((t - t0) / 3600000) * 0.8 + noise(0.03) }
        : {}),
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
  // Separate random stream so adding motion never changes the GPS track.
  const mrnd = mulberry32((opts.seed ?? 42) + 7919);
  const motion: MotionEvent[] = [];
  const TURN_WAVE = 120; // m along the piste per left+right pair
  const TURN_AMP = 15; // m either side of the piste's centre line

  for (let r = 0; r < runCount; r++) {
    if (opts.touring) {
      // Skin up a zig-zag track west of the piste: ~0.9 m/s, ~0.2 m/s of climb.
      wait(120, 0, 0, BASE_ALT);
      const climbSeconds = Math.round((TOP_ALT - BASE_ALT) / 0.2);
      for (let k = 0; k < climbSeconds; k++) {
        const u = k / climbSeconds;
        const zig = 60 * Math.sin(u * Math.PI * 24);
        emit(-150 + zig + top[0] * u, top[1] * u, BASE_ALT + (TOP_ALT - BASE_ALT) * u, 0.9);
      }
    } else {
      // Queue at the base, then ride the chairlift straight up.
      wait(60 + Math.round(rnd() * 60), 0, 0, BASE_ALT);
      for (let s = 0; s < liftLen; s += LIFT_SPEED) {
        const u = s / liftLen;
        emit(top[0] * u, top[1] * u, BASE_ALT + (TOP_ALT - BASE_ALT) * u, LIFT_SPEED);
      }
    }
    wait(30 + Math.round(rnd() * 30), top[0], top[1], TOP_ALT);

    // Ski down: accelerate, carve with speed variations, peak on the steep middle section, slow at the bottom.
    const vmax = tops[r % tops.length];
    let runTop = 0;
    let s = 0;
    const runStart = t;
    while (s < L) {
      const u = s / L;
      const envelope = Math.min(1, u * 12, (1 - u) * 10); // ramp in / out
      const carve = 0.85 + 0.15 * Math.sin(u * Math.PI * 14);
      const v = Math.max(2.5, vmax * envelope * carve);
      if (v > runTop) runTop = v;
      let [x, y] = polylineAt(PISTE, pisteLen, s);
      if (opts.turns) {
        const [x2, y2] = polylineAt(PISTE, pisteLen, Math.min(L, s + 5));
        const len = Math.hypot(x2 - x, y2 - y) || 1;
        const side = TURN_AMP * Math.sin((2 * Math.PI * s) / TURN_WAVE) * Math.min(1, u * 20, (1 - u) * 20);
        const nx = -(y2 - y) / len, ny = (x2 - x) / len; // left of the direction of travel
        x += nx * side;
        y += ny * side;
      }
      // Smooth, strictly descending altitude profile.
      const f = u + 0.06 * Math.sin(2 * Math.PI * u);
      emit(x, y, TOP_ALT - (TOP_ALT - BASE_ALT) * f, v);
      s += v;
    }
    usedTops.push(runTop);
    const runSecs = (t - runStart) / 1000;
    const jumps = 1 + Math.floor(mrnd() * 3);
    for (let k = 0; k < jumps; k++) {
      const at = runStart + Math.round(runSecs * (0.2 + 0.6 * mrnd())) * 1000;
      motion.push({ t: at, kind: 'jump', value: Math.round((0.3 + mrnd() * 0.9) * 100) / 100 });
    }
    if (r === 2) motion.push({ t: runStart + Math.round(runSecs * 0.5) * 1000, kind: 'fall', value: Math.round((3.5 + mrnd() * 2) * 10) / 10 });
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

  motion.sort((a, b) => a.t - b.t);
  return {
    points,
    motion,
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
