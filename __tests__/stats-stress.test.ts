import { cleanTrack, completedRuns, computeStats, smoothedAltitudes, statsForSport } from '../src/lib/stats';
import { simulateDay } from '../src/lib/sim';
import type { DayStats, TrackPoint } from '../src/lib/types';

/** Fuzz: whatever the GPS throws at us, the day's stats stay self-consistent. */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Throws with a readable message on the first broken invariant. */
function checkInvariants(s: DayStats, label: string) {
  const fail = (msg: string) => { throw new Error(`${label}: ${msg}`); };
  const finite = (v: unknown, path: string) => {
    if (typeof v === 'number' && !Number.isFinite(v)) fail(`${path} = ${v}`);
  };
  for (const [k, v] of Object.entries(s)) if (k !== 'activities') finite(v, k);
  let prevEnd = -1, runs = 0, lifts = 0, ski = 0, runDown = 0;
  s.activities.forEach((a, i) => {
    for (const [k, v] of Object.entries(a)) finite(v, `activities[${i}].${k}`);
    if (a.startIndex > a.endIndex) fail(`activity ${i} start ${a.startIndex} > end ${a.endIndex}`);
    if (a.startIndex < prevEnd) fail(`activity ${i} overlaps previous (${a.startIndex} < ${prevEnd})`);
    if (a.endTime < a.startTime) fail(`activity ${i} ends before it starts`);
    if (Math.abs(a.duration - (a.endTime - a.startTime) / 1000) > 1e-6) fail(`activity ${i} duration mismatch`);
    if (a.duration < 0 || a.distance < 0 || a.verticalDown < 0 || a.verticalUp < 0) fail(`activity ${i} negative`);
    if ((a.stopTime ?? 0) > a.duration + 1e-6) fail(`activity ${i} stopTime > duration`);
    if ((a.wait ?? 0) < 0) fail(`activity ${i} negative wait`);
    if (a.topSpeed > s.topSpeed + 1e-9) fail(`activity ${i} topSpeed ${a.topSpeed} > day ${s.topSpeed}`);
    if (a.kind === 'run' && a.avgSpeed > 45 && !label.startsWith('tooFast')) fail(`run ${i} avgSpeed ${a.avgSpeed} faster than any skier`);
    if (a.kind === 'run') { runs++; ski += a.duration; runDown += a.verticalDown; }
    if (a.kind === 'lift') lifts++;
    prevEnd = a.endIndex;
  });
  if (s.runCount !== runs) fail(`runCount ${s.runCount} != ${runs}`);
  if (s.liftCount !== lifts) fail(`liftCount ${s.liftCount} != ${lifts}`);
  if (Math.abs(s.skiTime - ski) > 1e-6) fail(`skiTime ${s.skiTime} != ${ski}`);
  if (s.skiTime > s.duration + 1e-6 || s.liftTime > s.duration + 1e-6) fail('ski/lift time > day');
  if (s.duration < 0 || s.movingTime < 0 || s.movingTime > s.duration + 1e-6) fail('day duration/moving');
  if (s.skiDistance > s.distance + 1e-6) fail('skiDistance > distance');
  // Per-run hysteresis restarts at each run's top, so the runs can add up to a little more than the day:
  // at most verticalHysteresis (4 m) per run.
  if (runDown > s.verticalDown + 4 * runs + 1e-6) fail(`runs drop ${runDown} > day ${s.verticalDown}`);
  if (s.maxAlt != null && s.minAlt != null && s.minAlt > s.maxAlt) fail('minAlt > maxAlt');
}

function checkAll(pts: TrackPoint[], label: string) {
  const s = computeStats(pts);
  checkInvariants(s, label);
  // Indices point into the cleaned track: times must match it.
  const clean = cleanTrack(pts);
  for (const a of s.activities) {
    if (a.endIndex >= clean.length) throw new Error(`${label}: index ${a.endIndex} out of range ${clean.length}`);
    if (clean[a.startIndex].t !== a.startTime || clean[a.endIndex].t !== a.endTime) throw new Error(`${label}: times off`);
  }
  expect(computeStats(pts)).toEqual(s); // deterministic
  statsForSport(s, null);
  statsForSport(s, 'touring');
  completedRuns(s);
  for (const v of smoothedAltitudes(clean)) if (v != null && !Number.isFinite(v)) throw new Error(`${label}: alt ${v}`);
  return s;
}

const base = (n: number, dt = 1000, seed = 1): TrackPoint[] => {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    t: 1e12 + i * dt, lat: 47 + i * 2e-5, lon: 10 + r() * 1e-5, alt: 2000 - i * 0.5 + r() * 3, acc: 5, spd: null,
  }));
};

describe('stats stress', () => {
  it('simulated days with many options', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const r = rng(seed);
      const day = simulateDay({
        seed, runs: 1 + (seed % 4), noDoppler: seed % 2 === 0, barometer: seed % 3 === 0, touring: seed === 5,
        turns: seed % 4 === 1, gpsAltNoise: [3, 10, 30][seed % 3], spikes: Array.from({ length: 5 }, () => Math.floor(r() * 3000)),
      });
      checkAll(day.points, `sim ${seed}`);
    }
  });

  it('hostile inputs', () => {
    const sim = simulateDay({ seed: 3, runs: 2 }).points;
    const r = rng(99);
    const cases: Record<string, TrackPoint[]> = {
      empty: [],
      one: base(1),
      two: base(2),
      sameTime: base(50).map((p) => ({ ...p, t: 1e12 })),
      unsorted: sim.slice().sort(() => r() - 0.5),
      reversed: sim.slice().reverse(),
      duplicates: sim.flatMap((p, i) => (i % 3 ? [p] : [p, p, { ...p, lat: p.lat + 1e-5 }])),
      nanAlt: sim.map((p, i) => ({ ...p, alt: [NaN, Infinity, -Infinity, null][i % 7] ?? p.alt })),
      noAlt: sim.map((p) => ({ ...p, alt: null })),
      constAlt: sim.map((p) => ({ ...p, alt: 2000 })),
      nullAcc: sim.map((p) => ({ ...p, acc: null })),
      nanTime: sim.map((p, i) => (i % 50 === 7 ? { ...p, t: NaN } : p)),
      nanFirstTime: [{ ...sim[0], t: NaN }, { ...sim[0], t: Infinity }, ...sim],
      nanEverything: sim.map((p, i) => (i % 50 === 7 ? { ...p, t: NaN, lat: NaN, spd: NaN, acc: NaN } : p)),
      infSpd: sim.map((p, i) => (i % 13 ? p : { ...p, spd: Infinity })),
      hugeGaps: sim.map((p, i) => ({ ...p, t: p.t + Math.floor(i / 700) * 3 * 3600_000 })),
      // 10 fixes a second, interpolated between the simulator's 1 Hz fixes.
      tenthSecond: sim.slice(0, 600).flatMap((p, i) => {
        const q = sim[i + 1] ?? p;
        return Array.from({ length: 10 }, (_, k) => ({ ...p, t: p.t + k * 100, lat: p.lat + ((q.lat - p.lat) * k) / 10,
          lon: p.lon + ((q.lon - p.lon) * k) / 10, alt: (p.alt ?? 0) + (r() - 0.5) * 4 }));
      }),
      // Physically impossible: the whole day replayed 10x too fast.
      tooFast: sim.slice(0, 2000).map((p, i) => ({ ...p, t: sim[0].t + i * 100 })),
      sixtySecond: sim.filter((_, i) => i % 60 === 0),
      teleports: sim.map((p, i) => (i % 97 === 5 ? { ...p, lat: p.lat + 0.5 } : p)),
      altSpikes: sim.map((p, i) => (i % 101 === 3 ? { ...p, alt: (p.alt ?? 0) + (i % 2 ? 2000 : -2000) } : p)),
      frozenAlt: sim.map((p, i) => (Math.floor(i / 120) % 3 === 1 ? { ...p, alt: 2111.123456 } : p)),
      fillerFixes: sim.map((p, i) => (i % 40 < 8 ? { ...p, acc: 21, alt: 1500 } : p)),
      negativeAlt: sim.map((p) => ({ ...p, alt: (p.alt ?? 0) - 5000 })),
      zeroSpeedDoppler: sim.map((p) => ({ ...p, spd: 0 })),
      stillAllDay: base(3000).map((p) => ({ ...p, lat: 47, alt: 2000 })),
    };
    for (const [k, pts] of Object.entries(cases)) checkAll(pts, k);
  });

  it('random walks', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed * 7);
      let t = 1e12, lat = 47, lon = 10, alt = 1500 + r() * 1500, va = 0;
      const pts: TrackPoint[] = [];
      for (let i = 0; i < 600 + Math.floor(r() * 1500); i++) {
        t += r() < 0.02 ? r() * 600_000 : 200 + r() * 5000;
        va = Math.max(-15, Math.min(15, va + (r() - 0.5) * 3));
        lat += (r() - 0.5) * 2e-4;
        lon += (r() - 0.5) * 2e-4;
        alt += va;
        const x = r();
        pts.push({ t: Math.round(t), lat, lon, alt: x < 0.03 ? null : x < 0.05 ? alt + (r() - 0.5) * 3000 : alt,
          acc: r() < 0.1 ? null : r() * 50, spd: r() < 0.5 ? null : r() * 30 });
      }
      checkAll(pts, `walk ${seed}`);
    }
  });

  it('random mutations of a simulated day', () => {
    const sim = simulateDay({ seed: 8, runs: 3, noDoppler: true }).points;
    for (let seed = 1; seed <= 10; seed++) {
      const r = rng(seed * 31);
      const pts = sim.map((p) => {
        const x = r();
        if (x < 0.02) return { ...p, alt: (p.alt ?? 0) + (r() - 0.5) * 4000 };
        if (x < 0.03) return { ...p, alt: null };
        if (x < 0.035) return { ...p, lat: p.lat + (r() - 0.5) * 0.1 };
        if (x < 0.04) return { ...p, t: p.t - Math.floor(r() * 5000) };
        if (x < 0.05) return { ...p, acc: 21 + r() * 30 };
        return p;
      }).filter(() => r() > 0.05);
      checkAll(pts, `mutation ${seed}`);
    }
  });

  it('a 50k-fix day runs in reasonable time', () => {
    const day = simulateDay({ seed: 11, runs: 55, noDoppler: true }).points.slice(0, 50000);
    expect(day.length).toBeGreaterThan(40000);
    const t0 = Date.now();
    const s = computeStats(day);
    const ms = Date.now() - t0;
    checkInvariants(s, 'long day');
    console.log(`50k fixes: ${day.length} in ${ms} ms`);
    expect(ms).toBeLessThan(3000);
  });
});
