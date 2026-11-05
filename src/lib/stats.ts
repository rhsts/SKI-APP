import { fuseAltitude } from './altitude';
import { distance } from './geo';
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
  liftMinClimbRate: 0.5, // m/s vertical: slower climbs are hiking/walking
  liftMaxSpeed: 8, // m/s average along the lift
  liftMinStraightness: 0.6, // straight-line / path distance
  runMinAvgSpeed: 2, // m/s: slower descents are walking
  tourMinClimb: 40, // m: a climb under your own power must gain at least this
  tourMaxAvgSpeed: 2.5, // m/s: skinning/hiking pace
  queueMaxSeconds: 20 * 60, // longer stops before a lift are breaks, not lift lines
  queueMaxSpread: 150, // m: you stay put in a lift line
  maxGapForMoving: 30, // s: longer gaps (tunnel, signal lost) don't count as moving
  maxVertRate: 25, // m/s: faster altitude changes are GPS altitude glitches (a straight schuss is ~15)
  altResyncMs: 60000, // a new altitude level that holds this long is real (e.g. after a bad first fix)
  altResyncSpread: 20, // m: "holds" = stays within this
};

/**
 * Phones' GPS altitude sometimes jumps hundreds of metres for a few seconds.
 * Those fixes keep their position but lose their altitude (null), so the
 * gap is bridged from the neighbouring fixes.
 */
export function despikeAltitude(points: TrackPoint[]): TrackPoint[] {
  let ref: { alt: number; t: number } | null = null;
  let pending: TrackPoint[] = [];
  const out = points.slice();
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (p.alt == null || !Number.isFinite(p.alt)) continue;
    if (!ref) {
      ref = { alt: p.alt, t: p.t };
      continue;
    }
    const dt = Math.max(1, (p.t - ref.t) / 1000);
    if (Math.abs(p.alt - ref.alt) / dt <= CONFIG.maxVertRate) {
      ref = { alt: p.alt, t: p.t };
      pending = [];
      continue;
    }
    // Suspicious. If the new level holds for a minute, it was the old one that was wrong.
    if (pending.length && Math.abs(p.alt - pending[0].alt!) > CONFIG.altResyncSpread) pending = [];
    pending.push(p);
    if (p.t - pending[0].t >= CONFIG.altResyncMs) {
      ref = { alt: p.alt, t: p.t };
      pending = [];
      continue;
    }
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
  return despikeAltitude(out);
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
      push(isRun ? 'run' : 'other', s, e);
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
      const isLift =
        leg.duration > 0 &&
        climb / leg.duration >= CONFIG.liftMinClimbRate &&
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
  return markLiftLines(out, pts);
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

/** Everything the app shows about a day, computed from raw GPS fixes. */
export function computeStats(rawPoints: TrackPoint[]): DayStats {
  // Barometer (when the phone has one) gives far steadier altitude than GPS.
  const pts = fuseAltitude(cleanTrack(rawPoints));
  const n = pts.length;
  const empty: DayStats = {
    duration: 0, movingTime: 0, skiTime: 0, liftTime: 0, distance: 0, skiDistance: 0,
    topSpeed: 0, topSpeedTime: null, avgSkiSpeed: 0, verticalDown: 0, verticalUp: 0,
    maxAlt: null, minAlt: null, runCount: 0, liftCount: 0, longestRun: 0, activities: [],
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
    a.kind === 'run' ? { ...a, ...analyseTurns(pts, a.startIndex, a.endIndex, spd) } : a,
  );
  const runs = activities.filter((x) => x.kind === 'run');
  const lifts = activities.filter((x) => x.kind === 'lift');
  const tours = activities.filter((x) => x.kind === 'tour');
  const skiTime = runs.reduce((s, r) => s + r.duration, 0);
  const skiDistance = runs.reduce((s, r) => s + r.distance, 0);

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
    avgSkiSpeed: skiTime > 0 ? skiDistance / skiTime : 0,
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
