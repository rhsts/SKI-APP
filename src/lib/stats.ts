import { fuseAltitude } from './altitude';
import { distance } from './geo';
import { dropImpossibleSpeeds } from './slopes';
import { analyseTurns } from './turns';
import type { Activity, ActivityKind, DayStats, TrackPoint } from './types';

/** Tunables, exported so tests and future settings can reason about them. */
export const CONFIG = {
  maxAccuracy: 40, // m: worse fixes are ignored
  maxSpeed: 45, // m/s (162 km/h): anything faster is a GPS jump
  resyncAfter: 5, // consecutive rejects before we trust the new position
  speedWindowMs: 3000, // derived speed is measured over at least this long
  altSmoothing: 5, // moving-average window for altitude
  verticalHysteresis: 4, // m: altitude noise below this is ignored for vertical totals
  trendThreshold: 25, // m: altitude change that flips run <-> lift
  movingSpeed: 1, // m/s
  runEdgeSpeed: 1.5, // m/s: standing still at top/bottom of a run is trimmed off
  liftMinClimbRate: 0.5, // m/s vertical: slower climbs are hiking/walking…
  slowLiftMinSpeed: 1.1, // m/s straight-line while moving: …unless this fast, i.e. a T-bar or slow chair on gentle ground
  liftMaxSpeed: 8, // m/s average along the lift
  liftMinStraightness: 0.6, // straight-line / path distance
  runMinAvgSpeed: 2, // m/s: slower descents are walking
  tourMinClimb: 40, // m: a climb under your own power must gain at least this
  tourMaxAvgSpeed: 2.5, // m/s: skinning/hiking pace
  queueMaxSeconds: 20 * 60, // longer stops before a lift are breaks, not lift lines
  queueMaxSpread: 150, // m: you stay put in a lift line
  maxGapForMoving: 30, // s: longer gaps (tunnel, signal lost) don't count as moving
  maxVertRate: 25, // m/s: faster altitude changes are GPS altitude glitches (a straight schuss is ~15)
  altResyncMs: 60000, // a jump to a new altitude level that holds (changes smoothly) this long is real (e.g. after a bad first fix)
  altMedianMs: 15000, // ± this window: a running median removes short altitude wobbles
  mergeGapS: 90, // s: a "lift" or stop shorter than this between two runs is noise inside one run
  mergeGapClimb: 50, // m: …and it may not climb more than this
  noiseRunS: 40, // s: a "run" shorter than this between two lifts is noise inside one ride
  noiseRunDrop: 50, // m: …and it may not drop more than this
  downLiftMinS: 60, // s: riding a gondola/chair down lasts at least this…
  downLiftMaxWinding: 1.05, // …its path is this close to a straight line (path / straight-line distance)…
  downLiftMaxSpeedCv: 0.2, // …and its speed this steady (std dev / mean). Real runs turn and vary.
  // Some phones freeze GPS altitude for a minute or more, then jump: mid-lift that looks like a short run.
  fakeRunMaxWinding: 1.02, // a "run" this close to a dead-straight line…
  fakeRunMaxSpeedCv: 0.3, // …at this steady a speed is really a lift ride
  stopMinS: 30, // s: standing still this long partway down a run counts as a stop
  stopBlipS: 10, // s: shuffling about for less than this doesn't end a stop
};

/** Bump whenever detection logic changes, so days saved by older versions get their stats recomputed. */
export const STATS_VERSION = 3;

/**
 * Phones' GPS altitude sometimes jumps hundreds of metres for a few seconds.
 * Those fixes keep their position but lose their altitude (null), so the
 * gap is bridged from the neighbouring fixes.
 */
export function despikeAltitude(points: TrackPoint[]): TrackPoint[] {
  // ref: last trusted fix; lone = nothing has confirmed it yet (the very first fix).
  let ref: { alt: number; t: number; i: number; lone: boolean } | null = null;
  let pending: number[] = []; // indexes of rejected fixes that follow each other smoothly
  const out = points.slice();
  const plausible = (alt: number, t: number, from: { alt: number; t: number }) =>
    Math.abs(alt - from.alt) / Math.max(1, (t - from.t) / 1000) <= CONFIG.maxVertRate;
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (p.alt == null || !Number.isFinite(p.alt)) continue;
    if (!ref) {
      ref = { alt: p.alt, t: p.t, i, lone: true };
      continue;
    }
    const last = pending.length ? points[pending[pending.length - 1]] : null;
    // Still on the suspicious new level: it must hold for altResyncMs, however far it jumped.
    if (last && plausible(p.alt, p.t, last as { alt: number; t: number })) {
      pending.push(i);
      if (p.t - points[pending[0]].t >= CONFIG.altResyncMs) {
        // It held, so the old level was wrong: give the pending fixes their altitudes back.
        for (const k of pending) out[k] = points[k];
        if (ref.lone) out[ref.i] = { ...points[ref.i], alt: null };
        ref = { alt: p.alt, t: p.t, i, lone: false };
        pending = [];
      } else {
        out[i] = { ...p, alt: null };
      }
      continue;
    }
    if (plausible(p.alt, p.t, ref)) {
      ref = { alt: p.alt, t: p.t, i, lone: false };
      pending = [];
      continue;
    }
    pending = [i];
    out[i] = { ...p, alt: null };
  }
  return out;
}

/** Drops inaccurate, duplicate and teleporting fixes, and blanks out glitched altitudes. */
export function cleanTrack(points: TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  let rejects = 0;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (p.acc != null && p.acc > CONFIG.maxAccuracy) continue;
    const last = out[out.length - 1];
    if (last) {
      const dt = (p.t - last.t) / 1000;
      if (dt <= 0) continue;
      if (distance(last, p) / dt > CONFIG.maxSpeed && rejects < CONFIG.resyncAfter) {
        rejects++;
        continue;
      }
    }
    rejects = 0;
    out.push(p);
  }
  return despikeAltitude(dropImpossibleSpeeds(out));
}

/** Cumulative path distance in metres for each index. */
export function cumulativeDistance(points: TrackPoint[]): number[] {
  const cum = new Array<number>(points.length);
  let d = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) d += distance(points[i - 1], points[i]);
    cum[i] = d;
  }
  return cum;
}

function median3(a: number, b: number, c: number) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/**
 * Per-point speed in m/s, robust against single-fix GPS spikes:
 * Doppler speed from the receiver when present, otherwise distance over a
 * >= 3 s window; then a 3-point median.
 */
export function smoothedSpeeds(points: TrackPoint[], cum = cumulativeDistance(points)): number[] {
  const n = points.length;
  const raw = new Array<number>(n).fill(0);
  let j = 0;
  for (let i = 1; i < n; i++) {
    const p = points[i];
    if (p.spd != null && Number.isFinite(p.spd) && p.spd >= 0) {
      raw[i] = p.spd;
    } else {
      while (j + 1 < i && p.t - points[j + 1].t >= CONFIG.speedWindowMs) j++;
      const k = p.t - points[j].t >= CONFIG.speedWindowMs ? j : 0;
      const dt = (p.t - points[k].t) / 1000;
      raw[i] = dt > 0 ? (cum[i] - cum[k]) / dt : 0;
    }
    raw[i] = Math.min(raw[i], CONFIG.maxSpeed);
  }
  if (n < 3) return raw;
  const out = raw.slice();
  for (let i = 1; i < n - 1; i++) out[i] = median3(raw[i - 1], raw[i], raw[i + 1]);
  out[n - 1] = Math.min(raw[n - 1], raw[n - 2]);
  return out;
}

/** Altitude with gaps filled (carry nearest known value) and a centred moving average. */
export function smoothedAltitudes(points: TrackPoint[]): (number | null)[] {
  const n = points.length;
  const filled: (number | null)[] = points.map((p) => (p.alt != null && Number.isFinite(p.alt) ? p.alt : null));
  const firstKnown = filled.findIndex((a) => a != null);
  if (firstKnown < 0) return filled;
  for (let i = 0; i < firstKnown; i++) filled[i] = filled[firstKnown];
  for (let i = firstKnown + 1; i < n; i++) if (filled[i] == null) filled[i] = filled[i - 1];
  // Running median over ±15 s: GPS altitude on some phones wobbles 50–100 m for a few
  // fixes, which would otherwise split one run into run + "lift" + run.
  const med = new Array<number>(n);
  let lo = 0, hi = 0;
  const win: number[] = [];
  for (let i = 0; i < n; i++) {
    while (lo < i && points[i].t - points[lo].t > CONFIG.altMedianMs) lo++;
    while (hi < n && points[hi].t - points[i].t <= CONFIG.altMedianMs) hi++;
    win.length = 0;
    for (let k = lo; k < hi; k++) win.push(filled[k] as number);
    win.sort((a, b) => a - b);
    med[i] = win.length % 2 ? win[win.length >> 1] : (win[(win.length >> 1) - 1] + win[win.length >> 1]) / 2;
  }
  for (let i = 0; i < n; i++) filled[i] = med[i];
  const half = Math.floor(CONFIG.altSmoothing / 2);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      s += filled[k] as number;
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

/** Total descent/ascent with hysteresis so GPS altitude jitter doesn't add up. */
export function verticalTotals(alts: number[], from = 0, to = alts.length - 1) {
  let down = 0, up = 0;
  if (to <= from) return { down, up };
  let ref = alts[from];
  for (let i = from + 1; i <= to; i++) {
    const d = alts[i] - ref;
    if (d >= CONFIG.verticalHysteresis) { up += d; ref = alts[i]; }
    else if (-d >= CONFIG.verticalHysteresis) { down -= d; ref = alts[i]; }
  }
  return { down, up };
}

/**
 * Splits the day into legs of alternating altitude trend. A leg only ends once
 * altitude moves `trendThreshold` metres the other way, so bumps and small
 * uphill bits inside a run don't split it.
 */
export function trendLegs(alts: number[]): { start: number; end: number; dir: -1 | 0 | 1 }[] {
  const n = alts.length;
  if (n < 2) return n ? [{ start: 0, end: 0, dir: 0 }] : [];
  const T = CONFIG.trendThreshold;
  const pivots = [0];
  let dir: -1 | 0 | 1 = 0;
  let firstDir: -1 | 0 | 1 = 0;
  let hi = 0, lo = 0, ext = 0;
  for (let i = 1; i < n; i++) {
    const a = alts[i];
    if (dir === 0) {
      if (a > alts[hi]) hi = i;
      if (a < alts[lo]) lo = i;
      if (a - alts[lo] >= T) { dir = 1; ext = i; }
      else if (alts[hi] - a >= T) { dir = -1; ext = i; }
      if (dir !== 0) firstDir = dir; // the opening wiggle belongs to the first leg
    } else if (dir === 1) {
      if (a >= alts[ext]) ext = i;
      else if (alts[ext] - a >= T) { pivots.push(ext); dir = -1; ext = i; }
    } else {
      if (a <= alts[ext]) ext = i;
      else if (a - alts[ext] >= T) { pivots.push(ext); dir = 1; ext = i; }
    }
  }
  if (dir === 0) return [{ start: 0, end: n - 1, dir: 0 }];
  if (ext !== n - 1) pivots.push(ext);
  pivots.push(n - 1);
  const legs: { start: number; end: number; dir: -1 | 0 | 1 }[] = [];
  let d: -1 | 0 | 1 = firstDir;
  for (let k = 0; k < pivots.length - 1; k++) {
    const isTail = k === pivots.length - 2 && ext !== n - 1;
    if (pivots[k + 1] > pivots[k]) legs.push({ start: pivots[k], end: pivots[k + 1], dir: isTail ? 0 : d });
    d = d === 1 ? -1 : 1;
  }
  return legs;
}

function summarise(
  kind: ActivityKind,
  s: number,
  e: number,
  pts: TrackPoint[],
  cum: number[],
  spd: number[],
  alts: number[] | null,
): Activity {
  let top = 0;
  for (let i = s; i <= e; i++) if (spd[i] > top) top = spd[i];
  const duration = (pts[e].t - pts[s].t) / 1000;
  const dist = cum[e] - cum[s];
  const v = alts ? verticalTotals(alts, s, e) : { down: 0, up: 0 };
  return {
    kind,
    startIndex: s,
    endIndex: e,
    startTime: pts[s].t,
    endTime: pts[e].t,
    duration,
    distance: dist,
    verticalDown: v.down,
    verticalUp: v.up,
    topSpeed: top,
    avgSpeed: duration > 0 ? dist / duration : 0,
  };
}

/** Classifies the day into runs, lifts and other (breaks, walking, hiking). */
export function segmentActivities(
  pts: TrackPoint[],
  cum: number[],
  spd: number[],
  alts: (number | null)[],
): Activity[] {
  if (pts.length < 2) return [];
  const hasAlt = alts.length > 0 && alts[0] != null;
  if (!hasAlt) return [summarise('other', 0, pts.length - 1, pts, cum, spd, null)];
  const a = alts as number[];
  const out: Activity[] = [];
  const push = (kind: ActivityKind, s: number, e: number) => {
    if (e <= s) return;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind && kind === 'other') {
      out[out.length - 1] = summarise('other', prev.startIndex, e, pts, cum, spd, a);
    } else {
      out.push(summarise(kind, s, e, pts, cum, spd, a));
    }
  };

  for (const leg of trendLegs(a)) {
    const { start, end, dir } = leg;
    if (dir === -1) {
      // Trim standing around at the top and bottom of the run.
      let s = start, e = end;
      while (s < e && spd[s] < CONFIG.runEdgeSpeed) s++;
      while (e > s && spd[e] < CONFIG.runEdgeSpeed) e--;
      const run = summarise('run', s, e, pts, cum, spd, a);
      const isRun = run.avgSpeed >= CONFIG.runMinAvgSpeed && a[s] - a[e] >= CONFIG.trendThreshold * 0.6;
      push('other', start, s);
      push(isRun ? (isDownLift(run, s, e, pts, spd, a) ? 'lift' : 'run') : 'other', s, e);
      push('other', e, end);
    } else if (dir === 1) {
      // Trim the queue at the bottom and standing around at the top.
      let s = start, e = end;
      while (s < e && spd[s] < CONFIG.movingSpeed) s++;
      while (e > s && spd[e] < CONFIG.movingSpeed) e--;
      const leg = summarise('lift', s, e, pts, cum, spd, a);
      const climb = a[e] - a[s];
      const straight = distance(pts[s], pts[e]);
      const straightness = leg.distance > 0 ? straight / leg.distance : 0;
      // ponytail: skinning/hiking is slower than 1.1 m/s; a fast walk uphill in a straight line would pass for a lift.
      const isLift =
        leg.duration > 0 &&
        (climb / leg.duration >= CONFIG.liftMinClimbRate || straightSpeed(s, e, pts, spd) >= CONFIG.slowLiftMinSpeed) &&
        leg.avgSpeed <= CONFIG.liftMaxSpeed &&
        straightness >= CONFIG.liftMinStraightness;
      // A slow, steady climb that isn't a lift: ski touring / hiking up.
      const isTour =
        !isLift &&
        climb >= CONFIG.tourMinClimb &&
        leg.avgSpeed <= CONFIG.tourMaxAvgSpeed &&
        climb / Math.max(1, leg.duration) < CONFIG.liftMinClimbRate;
      push('other', start, s);
      push(isLift ? 'lift' : isTour ? 'tour' : 'other', s, e);
      push('other', e, end);
    } else {
      push('other', start, end);
    }
  }
  return markLiftLines(mergeNoise(out, pts, cum, spd, a), pts);
}

/**
 * Riding a gondola or chair back down: a dead-straight descent at a steady
 * speed and a steady sink rate. Deliberately strict, so a real run is never
 * taken for one: runs turn, and their speed varies.
 */
function isDownLift(run: Activity, s: number, e: number, pts: TrackPoint[], spd: number[], a: number[]): boolean {
  if (run.duration < CONFIG.downLiftMinS || run.avgSpeed > CONFIG.liftMaxSpeed) return false;
  if (winding(run, pts) > CONFIG.downLiftMaxWinding || speedCv(spd, s, e) > CONFIG.downLiftMaxSpeedCv) return false;
  // Steady descent: each half drops at least a quarter of the total.
  const mid = (s + e) >> 1, drop = a[s] - a[e];
  return a[s] - a[mid] >= drop / 4 && a[mid] - a[e] >= drop / 4;
}

/**
 * Straight-line distance covered per second of moving (stops left out), m/s.
 * Unlike path speed, GPS jitter can't inflate it, and a zig-zag skin track scores low.
 */
function straightSpeed(s: number, e: number, pts: TrackPoint[], spd: number[]): number {
  let time = 0;
  for (let i = s + 1; i <= e; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 1000;
    if (spd[i] > CONFIG.movingSpeed / 2 && dt <= CONFIG.maxGapForMoving) time += dt; // slow skinning still counts as moving
  }
  return time > 0 ? distance(pts[s], pts[e]) / time : 0;
}

/** Path length / straight-line distance (1 = dead straight). */
function winding(a: Activity, pts: TrackPoint[]): number {
  const straight = distance(pts[a.startIndex], pts[a.endIndex]);
  return straight > 0 ? a.distance / straight : Infinity;
}

/** How much speed varies (std dev / mean). */
function speedCv(spd: number[], s: number, e: number): number {
  let sum = 0, sq = 0;
  for (let i = s; i <= e; i++) { sum += spd[i]; sq += spd[i] * spd[i]; }
  const n = e - s + 1, mean = sum / n;
  return mean > 0 ? Math.sqrt(Math.max(0, sq / n - mean * mean)) / mean : Infinity;
}

/**
 * A "run" no skier made: steeper than 45° on average (an altitude jump), or a
 * dead-straight line at a lift's steady speed (frozen altitude on a lift, then a jump).
 */
function isFakeRun(a: Activity, pts: TrackPoint[], spd: number[]): boolean {
  if (a.kind !== 'run') return false;
  if (a.verticalDown > a.distance) return true;
  return a.avgSpeed <= CONFIG.liftMaxSpeed && winding(a, pts) <= CONFIG.fakeRunMaxWinding
    && speedCv(spd, a.startIndex, a.endIndex) <= CONFIG.fakeRunMaxSpeedCv;
}

/**
 * Cleans up what altitude noise leaves behind: a run interrupted by a tiny
 * "lift" or a short stop is one run, and a lift ride with a tiny "run" in it is
 * one ride.
 */
function mergeNoise(acts: Activity[], pts: TrackPoint[], cum: number[], spd: number[], alts: number[]): Activity[] {
  let list = acts;
  let changed = true;
  const merge = (i: number, j: number, kind: ActivityKind) => {
    list = [...list.slice(0, i), summarise(kind, list[i].startIndex, list[j].endIndex, pts, cum, spd, alts), ...list.slice(j + 1)];
    changed = true;
  };
  while (changed) {
    changed = false;
    for (let i = 1; i < list.length - 1; i++) {
      const [a, m, b] = [list[i - 1], list[i], list[i + 1]];
      const runGap = a.kind === 'run' && b.kind === 'run' && m.kind !== 'run'
        && m.duration < CONFIG.mergeGapS && m.verticalUp < CONFIG.mergeGapClimb;
      const liftGap = a.kind === 'lift' && b.kind === 'lift' && m.kind === 'run'
        && ((m.duration < CONFIG.noiseRunS && m.verticalDown < CONFIG.noiseRunDrop) || isFakeRun(m, pts, spd));
      if (runGap || liftGap) { merge(i - 1, i + 1, a.kind); break; }
    }
    if (changed) continue;
    // A fake run right after or before a lift is part of that ride.
    for (let i = 0; i < list.length - 1; i++) {
      const [a, b] = [list[i], list[i + 1]];
      if ((a.kind === 'lift' && isFakeRun(b, pts, spd)) || (isFakeRun(a, pts, spd) && b.kind === 'lift')) { merge(i, i + 1, 'lift'); break; }
    }
  }
  // Any other fake run: we don't know what you were doing.
  const out: Activity[] = [];
  for (const x of list) {
    const kind = isFakeRun(x, pts, spd) ? 'other' : x.kind;
    const prev = out[out.length - 1];
    if (kind === 'other' && prev?.kind === 'other') out[out.length - 1] = summarise('other', prev.startIndex, x.endIndex, pts, cum, spd, alts);
    else out.push(kind === x.kind ? x : summarise(kind, x.startIndex, x.endIndex, pts, cum, spd, alts));
  }
  return out;
}

/**
 * The stop right before a lift ride is the lift line, if you stayed put and it
 * wasn't long enough to be a break.
 */
function markLiftLines(acts: Activity[], pts: TrackPoint[]): Activity[] {
  return acts.map((a, i) => {
    if (a.kind !== 'lift' || i === 0) return a;
    const prev = acts[i - 1];
    if (prev.kind !== 'other' || prev.duration > CONFIG.queueMaxSeconds) return { ...a, wait: 0 };
    // Only the part of the stop near the lift's bottom station counts.
    const bottom = pts[a.startIndex];
    let k = prev.endIndex;
    while (k > prev.startIndex && distance(pts[k], bottom) <= CONFIG.queueMaxSpread) k--;
    return { ...a, wait: Math.max(0, (pts[prev.endIndex].t - pts[k].t) / 1000) };
  });
}

/** Stops partway down a run: stretches below walking pace of at least `stopMinS`. */
export function runStops(pts: TrackPoint[], spd: number[], s: number, e: number): { stops: number; stopTime: number } {
  let stops = 0, stopTime = 0;
  let from = -1, to = -1; // current stop: first and last slow fix
  const close = () => {
    const d = (pts[to].t - pts[from].t) / 1000;
    if (d >= CONFIG.stopMinS) { stops++; stopTime += d; }
    from = -1;
  };
  for (let i = s; i <= e; i++) {
    if (spd[i] < CONFIG.movingSpeed) {
      if (from < 0) from = i;
      to = i;
    } else if (from >= 0 && (pts[i].t - pts[to].t) / 1000 > CONFIG.stopBlipS) {
      close();
    }
  }
  if (from >= 0) close();
  return { stops, stopTime };
}

/** A run's average speed leaves its stops out: waiting for friends doesn't make you slow. */
function withStops(run: Activity, stops: { stops: number; stopTime: number }): Activity {
  const moving = run.duration - stops.stopTime;
  return { ...run, ...stops, avgSpeed: moving > 0 ? run.distance / moving : run.avgSpeed };
}

/** Everything the app shows about a day, computed from raw GPS fixes. */
export function computeStats(rawPoints: TrackPoint[]): DayStats {
  // Barometer (when the phone has one) gives far steadier altitude than GPS.
  const pts = fuseAltitude(cleanTrack(rawPoints));
  const n = pts.length;
  const empty: DayStats = {
    duration: 0, movingTime: 0, skiTime: 0, liftTime: 0, distance: 0, skiDistance: 0,
    topSpeed: 0, topSpeedTime: null, avgSkiSpeed: 0, verticalDown: 0, verticalUp: 0,
    maxAlt: null, minAlt: null, runCount: 0, liftCount: 0, longestRun: 0, activities: [], statsVersion: STATS_VERSION,
  };
  if (n === 0) return empty;

  const cum = cumulativeDistance(pts);
  const spd = smoothedSpeeds(pts, cum);
  const alts = smoothedAltitudes(pts);

  let top = 0, topT: number | null = null, moving = 0;
  for (let i = 0; i < n; i++) {
    if (spd[i] > top) { top = spd[i]; topT = pts[i].t; }
    if (i > 0) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt <= CONFIG.maxGapForMoving && spd[i] > CONFIG.movingSpeed) moving += dt;
    }
  }

  let maxAlt: number | null = null, minAlt: number | null = null;
  for (const p of pts) {
    if (p.alt == null || !Number.isFinite(p.alt)) continue;
    if (maxAlt == null || p.alt > maxAlt) maxAlt = p.alt;
    if (minAlt == null || p.alt < minAlt) minAlt = p.alt;
  }

  const hasAlt = alts[0] != null;
  const vert = hasAlt ? verticalTotals(alts as number[]) : { down: 0, up: 0 };
  const activities = segmentActivities(pts, cum, spd, alts).map((a) =>
    a.kind === 'run' ? withStops({ ...a, ...analyseTurns(pts, a.startIndex, a.endIndex, spd) }, runStops(pts, spd, a.startIndex, a.endIndex)) : a,
  );
  const runs = activities.filter((x) => x.kind === 'run');
  const lifts = activities.filter((x) => x.kind === 'lift');
  const tours = activities.filter((x) => x.kind === 'tour');
  const skiTime = runs.reduce((s, r) => s + r.duration, 0);
  const skiDistance = runs.reduce((s, r) => s + r.distance, 0);
  const skiMovingTime = skiTime - runs.reduce((s, r) => s + (r.stopTime ?? 0), 0);

  return {
    duration: (pts[n - 1].t - pts[0].t) / 1000,
    movingTime: moving,
    skiTime,
    liftTime: lifts.reduce((s, r) => s + r.duration, 0),
    liftWaitTime: lifts.reduce((s, r) => s + (r.wait ?? 0), 0),
    tourTime: tours.reduce((s, r) => s + r.duration, 0),
    tourVertical: tours.reduce((s, r) => s + r.verticalUp, 0),
    distance: cum[n - 1],
    skiDistance,
    topSpeed: top,
    topSpeedTime: topT,
    avgSkiSpeed: skiMovingTime > 0 ? skiDistance / skiMovingTime : 0,
    verticalDown: vert.down,
    verticalUp: vert.up,
    maxAlt,
    minAlt,
    runCount: runs.length,
    liftCount: lifts.length,
    longestRun: runs.reduce((m, r) => Math.max(m, r.distance), 0),
    turns: runs.reduce((s, r) => s + (r.turns ?? 0), 0),
    maxG: runs.reduce((m, r) => Math.max(m, r.maxG ?? 0), 0),
    activities,
    statsVersion: STATS_VERSION,
  };
}

/** What the skier is doing right now, for the live status chip. */
export function liveStatus(stats: DayStats, lastSpeed: number): 'skiing' | 'lift' | 'stopped' | 'moving' {
  const meaningful = stats.activities.filter((a) => a.kind !== 'other' || a.duration > 20);
  const last = meaningful[meaningful.length - 1];
  if (lastSpeed < CONFIG.movingSpeed) return 'stopped';
  if (last?.kind === 'run') return 'skiing';
  if (last?.kind === 'lift') return 'lift';
  return 'moving';
}

/**
 * Runs that are over: you're on the next lift, or have stood at the bottom for 90 s.
 * (A short stop mid-run doesn't end it, so the live "run done" card isn't premature.)
 */
export function completedRuns(stats: DayStats): Activity[] {
  const acts = stats.activities;
  return acts.filter((a, i) => {
    if (a.kind !== 'run') return false;
    const after = acts.slice(i + 1);
    return after.some((x) => x.kind === 'lift') || after.reduce((s, x) => s + (x.kind === 'other' ? x.duration : 0), 0) >= 90;
  });
}

/**
 * Slow climbs look like ski touring (climbing on skins), but on a normal ski
 * day they're lifts with a patchy GPS track (a slow T-bar, a gondola in fog,
 * a sparse import). Only a day marked as ski touring keeps them as climbs.
 */
export function statsForSport(stats: DayStats, sport: string | null | undefined): DayStats {
  if (sport === 'touring' || !stats.activities.some((a) => a.kind === 'tour')) return stats;
  const activities = stats.activities.map((a) => (a.kind === 'tour' ? { ...a, kind: 'lift' as const, wait: a.wait ?? 0 } : a));
  const lifts = activities.filter((a) => a.kind === 'lift');
  return {
    ...stats,
    activities,
    liftCount: lifts.length,
    liftTime: lifts.reduce((s, a) => s + a.duration, 0),
    tourTime: 0,
    tourVertical: 0,
  };
}
