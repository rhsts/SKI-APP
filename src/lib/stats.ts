import { fuseAltitude } from './altitude';
import { distance, localProjector } from './geo';
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
  liftBendM: 40, // m: lifts run straight; stopped this far off a climb's straight line, or walking this far, you changed lift
  runMinAvgSpeed: 2, // m/s: slower descents are walking
  tourMinClimb: 40, // m: a climb under your own power must gain at least this
  tourMaxAvgSpeed: 2.5, // m/s: skinning/hiking pace
  queueMaxSpread: 150, // m: you stay put in a lift line
  maxGapForMoving: 30, // s: longer gaps (tunnel, signal lost) don't count as moving
  frozenAltMinFixes: 3, // this many fixes in a row with the exact same altitude…
  frozenAltMinDist: 50, // m: …over this much ground means the altitude is stuck, not flat
  frozenAltMaxRate: 5, // m/s: a stuck stretch starting further than this (+ trendThreshold) from the last good altitude starts with a jump
  frozenAltEdgeAcc: 20, // m: fixes this inaccurate either side of a stuck stretch have made-up altitudes
  cachedAltTimes: 4, // an exact altitude that comes back this many separate times…
  cachedAltMinMove: 100, // m: …each time after you've got this far from where it showed up…
  cachedAltGapMs: 60000, // …(gone this long in between makes it a separate time) is a cached value, not a reading
  cachedAltHomeM: 50, // m: it's kept this close to where it agrees with a real reading next to it (where it came from)
  altMedianMinFixes: 2, // the running median always reaches at least this many fixes each side (catches lone spikes when fixes are sparse)
  maxVertRate: 25, // m/s: faster altitude changes are GPS altitude glitches (a straight schuss is ~15)
  altStepNoise: 15, // m: an altitude change bigger than the ground covered (steeper than 45°) plus this is a glitch
  altResyncMs: 60000, // a jump to a new altitude level that holds (changes smoothly) this long is real (e.g. after a bad first fix)
  altMedianMs: 15000, // ± this window: a running median removes short altitude wobbles
  mergeGapS: 90, // s: a "lift" or stop shorter than this between two runs is noise inside one run
  mergeGapClimb: 50, // m: …and, unless it's a "lift" (too short to be a real one), it may not climb more than this
  noiseRunS: 40, // s: a "run" shorter than this between two lifts is noise inside one ride
  noiseRunDrop: 50, // m: …and it may not drop more than this
  downLiftMinS: 60, // s: riding a gondola/chair down lasts at least this…
  downLiftMaxWinding: 1.05, // …its path is this close to a straight line (path / straight-line distance)…
  downLiftMaxSpeedCv: 0.2, // …and its speed this steady (std dev / mean). Real runs turn and vary.
  // Some phones freeze GPS altitude for a minute or more, then jump: mid-lift that looks like a short run.
  fakeRunMaxWinding: 1.02, // a "run" this close to a dead-straight line…
  fakeRunMaxSpeedCv: 0.3, // …at this steady a speed is really a lift ride
  stopMinS: 30, // s: standing still this long partway down a run counts as a stop
  breakMinS: 10 * 60, // s: a stop this long partway down is a break (lunch, a hut) and splits the run
  stopBlipS: 10, // s: shuffling about for less than this doesn't end a stop
};

/** Bump whenever detection logic changes, so days saved by older versions get their stats recomputed. */
export const STATS_VERSION = 4;

/**
 * Phones' GPS altitude sometimes jumps hundreds of metres for a few seconds.
 * Those fixes keep their position but lose their altitude (null), so the
 * gap is bridged from the neighbouring fixes. A jump is a change too fast, or
 * steeper than any slope, from the last trusted fix.
 */
export function despikeAltitude(points: TrackPoint[]): TrackPoint[] {
  // ref: last trusted fix; lone = nothing has confirmed it yet (the very first fix).
  let ref: { alt: number; t: number; i: number; lone: boolean } | null = null;
  let pending: number[] = []; // indexes of rejected fixes that follow each other smoothly
  const out = points.slice();
  // How far the altitude moved from `from` as a share of what's plausible (above 1: a glitch). Too fast, or
  // steeper than 45°: over a gap of a minute or more the rate limit alone lets anything through.
  const misfit = (p: TrackPoint, from: { alt: number; t: number; i: number }) => {
    const d = Math.abs((p.alt as number) - from.alt);
    if (d / Math.max(1, (p.t - from.t) / 1000) > CONFIG.maxVertRate) return Infinity;
    return d / (CONFIG.altStepNoise + distance(points[from.i], p));
  };
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (p.alt == null || !Number.isFinite(p.alt)) continue;
    if (!ref) {
      ref = { alt: p.alt, t: p.t, i, lone: true };
      continue;
    }
    const toRef = misfit(p, ref);
    const li = pending[pending.length - 1];
    // Fixes all along: two fixes minutes apart don't show that a level held.
    const toLast = pending.length && p.t - points[li].t <= CONFIG.maxGapForMoving * 1000
      ? misfit(p, { alt: points[li].alt as number, t: points[li].t, i: li }) : Infinity;
    // Still on the suspicious new level (in line with it more than with the trusted one, unless that's only
    // the unconfirmed first fix): it must hold for altResyncMs, however far it jumped.
    if (toLast <= 1 && (ref.lone || toLast < toRef)) {
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
    if (toRef <= 1) {
      ref = { alt: p.alt, t: p.t, i, lone: false };
      pending = [];
      continue;
    }
    pending = [i];
    out[i] = { ...p, alt: null };
  }
  return out;
}

/**
 * Some phones keep reporting the exact same altitude (to the micrometre) for a
 * minute or more while you move, sometimes a value hundreds of metres off, then
 * carry on from the real one. Real GPS altitude always wobbles, so a moving
 * stretch of identical altitudes is unknown, not flat. Its first fix is often
 * right (where it got stuck), unless it is already a jump from the reading before
 * it, or that wasn't a real reading either.
 * Low-accuracy fixes right next to it (Slopes fills gaps with made-up ones) are
 * unknown too.
 */
export function unfreezeAltitude(points: TrackPoint[]): TrackPoint[] {
  const n = points.length;
  const frozen = new Array<boolean>(n).fill(false);
  let s = 0, path = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && points[i].alt != null && points[i].alt === points[s].alt) {
      path += distance(points[i - 1], points[i]);
      continue;
    }
    if (points[s].alt != null && i - s >= CONFIG.frozenAltMinFixes && path >= CONFIG.frozenAltMinDist) {
      let k = s - 1;
      while (k >= 0 && (points[k].acc ?? 0) >= CONFIG.frozenAltEdgeAcc) k--;
      // It got stuck where a real reading was: right after another stuck (or unknown) one, the first fix is no better.
      const jump = k >= 0 && (frozen[k] || points[k].alt == null || Math.abs((points[s].alt as number) - (points[k].alt as number))
        > CONFIG.trendThreshold + (CONFIG.frozenAltMaxRate * (points[s].t - points[k].t)) / 1000);
      frozen.fill(true, jump ? s : s + 1, i);
      for (k = s - 1; k >= 0 && (points[k].acc ?? 0) >= CONFIG.frozenAltEdgeAcc; k--) frozen[k] = true;
      for (k = i; k < n && (points[k].acc ?? 0) >= CONFIG.frozenAltEdgeAcc; k++) frozen[k] = true;
    }
    s = i;
    path = 0;
  }
  return points.map((p, i) => (frozen[i] ? { ...p, alt: null } : p));
}

/**
 * Some phones fill in an altitude they don't have with one they had earlier: the
 * exact same value (to the micrometre) keeps coming back all day, mixed in with
 * real readings, wherever you are. A real altitude can't keep reappearing while
 * you travel on, time after time; a rounded value that comes up by chance on
 * several runs shows up for a moment, not again 100 m further on. A cached value
 * is only right where it came from (a lift station, say): where it agrees with a
 * trusted reading next to it, one that isn't stuck or cached. There it's kept, even
 * stuck (standing in the lift line); everywhere else it's unknown.
 * `checked` is the track with stuck altitudes already blanked; it's returned with
 * the cached values sorted out.
 */
export function uncacheAltitude(points: TrackPoint[], checked = points): TrackPoint[] {
  // Per value: when it was last seen, where the current sighting started, whether it moved on, how many times it did.
  const seen = new Map<number, { t: number; at: TrackPoint; moved: boolean; times: number }>();
  for (const p of points) {
    if (p.alt == null || !Number.isFinite(p.alt)) continue;
    let s = seen.get(p.alt);
    if (!s || p.t - s.t > CONFIG.cachedAltGapMs) seen.set(p.alt, (s = { t: p.t, at: p, moved: false, times: s?.times ?? 0 }));
    s.t = p.t;
    if (!s.moved && distance(s.at, p) >= CONFIG.cachedAltMinMove) { s.moved = true; s.times++; }
  }
  const cached = (alt: number | null | undefined): alt is number => alt != null && (seen.get(alt)?.times ?? 0) >= CONFIG.cachedAltTimes;
  // Where each cached value is genuine: the nearest trusted reading either side (within cachedAltGapMs) agrees with it.
  const homes = new Map<number, TrackPoint[]>();
  points.forEach((p, i) => {
    const v = p.alt;
    if (!cached(v)) return;
    const agrees = (step: number) => {
      for (let k = i + step; k >= 0 && k < points.length && Math.abs(points[k].t - p.t) <= CONFIG.cachedAltGapMs; k += step) {
        if (checked[k].alt != null && !cached(points[k].alt)) return Math.abs((points[k].alt as number) - v) <= CONFIG.altStepNoise;
      }
      return false;
    };
    const home = homes.get(v) ?? [];
    // ponytail: one home per cachedAltHomeM/2, so a value seen all day doesn't make this quadratic.
    if ((agrees(-1) || agrees(1)) && !home.some((h) => distance(h, p) <= CONFIG.cachedAltHomeM / 2)) homes.set(v, [...home, p]);
  });
  return checked.map((q, i) => {
    const p = points[i];
    if (!cached(p.alt)) return q;
    return (homes.get(p.alt) ?? []).some((h) => distance(h, p) <= CONFIG.cachedAltHomeM) ? p : { ...p, alt: null };
  });
}

/** Drops inaccurate, duplicate and teleporting fixes, and blanks out glitched altitudes. */
export function cleanTrack(points: TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  let rejects = 0;
  for (const p of points) {
    if (!Number.isFinite(p.t) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
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
  const pts = dropImpossibleSpeeds(out);
  // Both look at the readings as they came: a cached value is often stuck for a while too (with made-up fixes either side).
  return despikeAltitude(uncacheAltitude(pts, unfreezeAltitude(pts)));
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

/**
 * Altitude with gaps filled and smoothed. A gap is bridged in a straight line by distance travelled
 * (altitude only changes as you move: standing at the top of a lift doesn't climb), or by time where
 * you didn't move at all; the ends are held.
 */
export function smoothedAltitudes(points: TrackPoint[], spd = smoothedSpeeds(points)): (number | null)[] {
  const n = points.length;
  // Distance travelled from speed, at most the step between fixes: GPS drift while standing still adds nothing,
  // and nor does a stop without fixes before skiing off.
  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.min(distance(points[i - 1], points[i]), (spd[i] * (points[i].t - points[i - 1].t)) / 1000);
  const filled: (number | null)[] = points.map((p) => (p.alt != null && Number.isFinite(p.alt) ? p.alt : null));
  const firstKnown = filled.findIndex((a) => a != null);
  if (firstKnown < 0) return filled;
  for (let i = 0; i < firstKnown; i++) filled[i] = filled[firstKnown];
  let prev = firstKnown;
  for (let i = firstKnown + 1; i < n; i++) {
    if (filled[i] == null) continue;
    const a = filled[prev] as number, b = filled[i] as number;
    const byDist = cum[i] - cum[prev] >= 1;
    const at = (k: number) => (byDist ? cum[k] - cum[prev] : points[k].t - points[prev].t);
    const span = Math.max(1, at(i));
    for (let k = prev + 1; k < i; k++) filled[k] = a + ((b - a) * at(k)) / span;
    prev = i;
  }
  for (let i = prev + 1; i < n; i++) filled[i] = filled[prev];
  // Running median over ±15 s: GPS altitude on some phones wobbles 50–100 m for a few
  // fixes, which would otherwise split one run into run + "lift" + run.
  const med = new Array<number>(n);
  let lo = 0, hi = 0;
  const win: number[] = [];
  for (let i = 0; i < n; i++) {
    while (i - lo > CONFIG.altMedianMinFixes && points[i].t - points[lo].t > CONFIG.altMedianMs) lo++;
    while (hi < n && (hi - i <= CONFIG.altMedianMinFixes || points[hi].t - points[i].t <= CONFIG.altMedianMs)) hi++;
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

  const minDrop = CONFIG.trendThreshold * 0.6; // m: less than this either side of a stop is just standing around
  const secs = (i: number, j: number) => (pts[j].t - pts[i].t) / 1000;

  // Standing about at the ends of a climb: the lift line at the bottom, getting off at the top.
  const trimClimb = (s: number, e: number): [number, number] => {
    const s0 = s;
    for (const [b0, b1] of stopSpans(pts, spd, s0, e)) {
      if (a[b1] - a[b0] >= minDrop) continue; // climbing slowly (skinning) isn't standing about
      if (a[b0] - a[s0] < minDrop) s = b1;
      else if (a[e] - a[b1] < minDrop) { e = b0; break; }
    }
    while (s < e && spd[s] < CONFIG.movingSpeed) s++;
    while (e > s && spd[e] < CONFIG.movingSpeed) e--;
    return [s, e];
  };

  const climbKind = (s: number, e: number): ActivityKind => {
    const leg = summarise('lift', s, e, pts, cum, spd, a);
    const climb = a[e] - a[s];
    const straightness = leg.distance > 0 ? distance(pts[s], pts[e]) / leg.distance : 0;
    // ponytail: skinning/hiking is slower than 1.1 m/s; a fast walk uphill in a straight line would pass for a lift.
    const isLift =
      leg.duration > 0 &&
      (climb / leg.duration >= CONFIG.liftMinClimbRate || straightSpeed(s, e, pts, spd) >= CONFIG.slowLiftMinSpeed) &&
      leg.avgSpeed <= CONFIG.liftMaxSpeed &&
      straightness >= CONFIG.liftMinStraightness;
    if (isLift) return 'lift';
    // A slow, steady climb that isn't a lift: ski touring / hiking up.
    return climb >= CONFIG.tourMinClimb && leg.avgSpeed <= CONFIG.tourMaxAvgSpeed && climb / Math.max(1, leg.duration) < CONFIG.liftMinClimbRate
      ? 'tour' : 'other';
  };

  // Slower than any lift goes, or a while without fixes going nowhere (phones log little while you stand still).
  const still = (i: number) => {
    const dt = secs(i - 1, i);
    return spd[i] < CONFIG.slowLiftMinSpeed || (dt > CONFIG.maxGapForMoving && distance(pts[i - 1], pts[i]) / dt < CONFIG.movingSpeed);
  };

  // Where you changed lift partway up a climb: a break (as long as one that splits a run), or else where you
  // were off the lift: slowed down off its straight line (lifts run straight), or walking a way. A chair that
  // stops, or a gondola crawling through a mid-station, stays put on its line; riding on round a bend at full
  // speed is one lift (a draglift).
  const liftChange = (s: number, e: number): [number, number] | null => {
    const T = CONFIG.trendThreshold;
    for (const [b0, b1] of stopSpans(pts, spd, s, e)) {
      if (secs(b0, b1) >= CONFIG.breakMinS && a[b1] - a[b0] < minDrop && a[b0] - a[s] >= T && a[e] - a[b1] >= T) return [b0, b1];
    }
    // Only the climbing: flat bits at the ends (skating to the lift, walking off) aren't on its line.
    let s1 = s, e1 = e;
    while (s1 < e1 && a[s1] - a[s] < T) s1++;
    while (e1 > s1 && a[e] - a[e1] < T) e1--;
    // How far a fix is from the straight line s1–e1 (between its ends).
    const { toXY } = localProjector(pts[s1]);
    const B = toXY(pts[e1]), len2 = B.x * B.x + B.y * B.y;
    const offLine = (p: TrackPoint) => {
      const P = toXY(p), u = len2 > 0 ? Math.max(0, Math.min(1, (P.x * B.x + P.y * B.y) / len2)) : 0;
      return Math.hypot(P.x - u * B.x, P.y - u * B.y);
    };
    let cut: [number, number] | null = null, far = CONFIG.liftBendM;
    for (let i = s1 + 1, r0 = -1; i < e1; i++) {
      if (!still(i)) { r0 = -1; continue; }
      if (r0 < 0) r0 = i - 1; // the last fix riding
      const off = Math.max(offLine(pts[i]), distance(pts[r0], pts[i]));
      if (off >= far) { far = off; cut = [r0, i]; }
    }
    if (cut) while (cut[1] + 1 < e1 && still(cut[1] + 1)) cut[1]++;
    return cut;
  };

  // A climb can be several lifts one after another; it's split only where both sides are lift rides on their own.
  const liftRides = (s: number, e: number): [number, number][] => {
    const cut = liftChange(s, e);
    if (cut) {
      const A = trimClimb(s, cut[0]), B = trimClimb(cut[1], e);
      const isRide = ([p, q]: [number, number]) => a[q] - a[p] >= CONFIG.trendThreshold && climbKind(p, q) === 'lift';
      if (isRide(A) && isRide(B)) return [...liftRides(...A), ...liftRides(...B)];
    }
    return [[s, e]];
  };

  for (const leg of trendLegs(a)) {
    const { start, end, dir } = leg;
    if (dir === -1) {
      // A long break (lunch, a long wait at the bottom) splits the descent, and so does a stop with next to
      // no skiing before or after it: little drop, and less time moving than standing. Each piece is judged on its own.
      const pieces: [number, number][] = [];
      const stops = stopSpans(pts, spd, start, end);
      let from = start, paused = 0, later = stops.reduce((t, [b0, b1]) => t + secs(b0, b1), 0);
      for (const [b0, b1] of stops) {
        const len = secs(b0, b1);
        later -= len;
        const standingAbove = a[start] - a[b0] < minDrop && secs(from, b0) - paused < len;
        const standingBelow = a[b1] - a[end] < minDrop && secs(b1, end) - later < len;
        if (len >= CONFIG.breakMinS || standingAbove || standingBelow) {
          pieces.push([from, b0]);
          from = b1;
          paused = 0;
        } else {
          paused += len;
        }
      }
      pieces.push([from, end]);
      let done = start;
      for (const [p0, p1] of pieces) {
        // Trim standing around at the top and bottom of the run.
        let s = p0, e = p1;
        while (s < e && spd[s] < CONFIG.runEdgeSpeed) s++;
        while (e > s && spd[e] < CONFIG.runEdgeSpeed) e--;
        const run = summarise('run', s, e, pts, cum, spd, a);
        // Moving speed: waiting for friends halfway down doesn't make it a walk.
        const moving = run.duration - runStops(pts, spd, s, e).stopTime;
        const isRun = run.distance / Math.max(1, moving) >= CONFIG.runMinAvgSpeed && a[s] - a[e] >= minDrop;
        push('other', done, s);
        push(isRun ? (isDownLift(run, s, e, pts, spd, a) ? 'lift' : 'run') : 'other', s, e);
        done = e;
      }
      push('other', done, end);
    } else if (dir === 1) {
      // Trim the queue at the bottom and standing around at the top (lunch, waiting for friends).
      let s = start, e = end, from = start;
      for (const [b0, b1] of stopSpans(pts, spd, start, end)) {
        if (a[b1] - a[b0] >= minDrop) continue; // climbing slowly (skinning) isn't standing around
        if (a[b0] - a[start] < minDrop) {
          // Still skiing on the flat before the first stop (the lowest altitude reading can come early):
          // that's the end of the run.
          const prev = out[out.length - 1];
          if (s === start && prev?.kind === 'run' && prev.endIndex === start) {
            let r = b0;
            while (r > start && spd[r] < CONFIG.runEdgeSpeed) r--;
            if (r > start) {
              from = r;
              out[out.length - 1] = summarise('run', prev.startIndex, r, pts, cum, spd, a);
            }
          }
          s = b1;
        } else if (a[end] - a[b1] < minDrop) { e = b0; break; }
      }
      while (s < e && spd[s] < CONFIG.movingSpeed) s++;
      while (e > s && spd[e] < CONFIG.movingSpeed) e--;
      let done = from;
      for (const [p0, p1] of liftRides(s, e)) {
        push('other', done, p0);
        push(climbKind(p0, p1), p0, p1);
        done = p1;
      }
      push('other', done, end);
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
      // A "lift" too short to be one, with only stops between it and a run either side, is altitude noise inside one run.
      if (m.kind === 'lift' && m.duration < CONFIG.mergeGapS) {
        let p = i - 1, q = i + 1;
        while (p > 0 && list[p].kind === 'other' && list[p].duration < CONFIG.breakMinS) p--;
        while (q < list.length - 1 && list[q].kind === 'other' && list[q].duration < CONFIG.breakMinS) q++;
        if (list[p].kind === 'run' && list[q].kind === 'run') { merge(p, q, 'run'); break; }
      }
    }
    if (changed) continue;
    // A fake run right after or before a lift is part of that ride, and so is a lift with no stop in between.
    for (let i = 0; i < list.length - 1; i++) {
      const [a, b] = [list[i], list[i + 1]];
      const sameRide = a.kind === 'lift' && b.kind === 'lift' && a.endIndex === b.startIndex;
      if (sameRide || (a.kind === 'lift' && isFakeRun(b, pts, spd)) || (isFakeRun(a, pts, spd) && b.kind === 'lift')) { merge(i, i + 1, 'lift'); break; }
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
 * wasn't long enough to be a break (as long as one that splits a run).
 */
function markLiftLines(acts: Activity[], pts: TrackPoint[]): Activity[] {
  return acts.map((a, i) => {
    if (a.kind !== 'lift' || i === 0) return a;
    const prev = acts[i - 1];
    if (prev.kind !== 'other') return { ...a, wait: 0 };
    // Only the part of the stop near the lift's bottom station counts.
    const bottom = pts[a.startIndex];
    let k = prev.endIndex;
    while (k > prev.startIndex && distance(pts[k], bottom) <= CONFIG.queueMaxSpread) k--;
    const wait = Math.max(0, (pts[prev.endIndex].t - pts[k].t) / 1000);
    return { ...a, wait: wait < CONFIG.breakMinS ? wait : 0 };
  });
}

/** Stops partway down a run: stretches below walking pace of at least `stopMinS`. */
export function runStops(pts: TrackPoint[], spd: number[], s: number, e: number): { stops: number; stopTime: number } {
  const spans = stopSpans(pts, spd, s, e);
  return { stops: spans.length, stopTime: spans.reduce((t, [a, b]) => t + (pts[b].t - pts[a].t) / 1000, 0) };
}

/** Standing still for stopMinS or longer between s and e: [first, last] slow fix of each stop. */
function stopSpans(pts: TrackPoint[], spd: number[], s: number, e: number): [number, number][] {
  const spans: [number, number][] = [];
  let from = -1, to = -1; // current stop: first and last slow fix
  const close = () => {
    if ((pts[to].t - pts[from].t) / 1000 >= CONFIG.stopMinS) spans.push([from, to]);
    from = -1;
  };
  for (let i = s; i <= e; i++) {
    // No fixes for a while: phones log little while you stand still. But if you got somewhere in the
    // meantime, you were moving (signal lost in a tunnel or under trees), not stopped.
    const dt = i > s ? (pts[i].t - pts[i - 1].t) / 1000 : 0;
    const gap = dt > CONFIG.maxGapForMoving && distance(pts[i - 1], pts[i]) / dt < CONFIG.movingSpeed;
    if (spd[i] < CONFIG.movingSpeed || gap) {
      if (from < 0) from = gap ? i - 1 : i;
      to = i;
    } else if (from >= 0 && (pts[i].t - pts[to].t) / 1000 > CONFIG.stopBlipS) {
      close();
    }
  }
  if (from >= 0) close();
  return spans;
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
  const alts = smoothedAltitudes(pts, spd);

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
