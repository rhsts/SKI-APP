import { distance, localProjector, simplify, type LatLon } from './geo';
import { cleanTrack } from './stats';
import type { TrackPoint } from './types';

/**
 * Challenges: a "segment" is a stretch of piste with a start gate and a finish
 * gate. Every time anyone skis through both gates without leaving the course,
 * that's a timed attempt. The fastest attempt is the time to beat.
 */

export type PathPoint = [lat: number, lon: number, alt: number | null];

export interface Segment {
  id: string;
  name: string;
  createdAt: number;
  creatorName: string | null;
  path: PathPoint[];
  gateRadius: number;
}

export interface Attempt {
  id: string; // see attemptId()
  segmentId: string;
  sessionId: string | null; // null for friends' attempts
  playerId: string;
  playerName: string;
  time: number; // s
  at: number; // epoch ms the attempt started
  /** Elapsed seconds at 0%, 5%, … 100% of the course — used as a live "ghost" to race against. */
  ghost: number[] | null;
}

export const GATE_RADIUS = 30; // m: pass within this of the start/finish point
export const OFF_COURSE = 60; // m: further than this from the line aborts the attempt
export const OFF_COURSE_FIXES = 3; // consecutive fixes off course before aborting
export const MIN_PROGRESS_TO_FINISH = 0.8; // of the course length, so a loop can't finish early
export const GHOST_SAMPLES = 20;
const MAX_SPEED = 45; // m/s, same cap as the stats
export const MIN_SEGMENT_LENGTH = 150; // m
export const MAX_PATH_POINTS = 150;

/** Same id on every phone (start time to the second), so shared results merge instead of duplicating. */
export function attemptId(playerId: string, at: number) {
  return `${playerId}:${Math.round(at / 1000)}`;
}

/** Simplified course line from a slice of a recorded track. */
export function buildSegmentPath(points: TrackPoint[], from: number, to: number): PathPoint[] {
  const slice = points.slice(from, to + 1);
  let tol = 3;
  let keep = simplify(slice, tol);
  while (keep.length > MAX_PATH_POINTS) {
    tol *= 1.5;
    keep = simplify(slice, tol);
  }
  return keep.map((i) => {
    const p = slice[i];
    return [round(p.lat, 6), round(p.lon, 6), p.alt == null ? null : Math.round(p.alt)];
  });
}

function round(v: number, d: number) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export function pathInfo(path: PathPoint[]) {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += distance({ lat: path[i - 1][0], lon: path[i - 1][1] }, { lat: path[i][0], lon: path[i][1] });
  }
  const a0 = path[0]?.[2];
  const a1 = path[path.length - 1]?.[2];
  return { length, drop: a0 != null && a1 != null ? a0 - a1 : null };
}

/** The course line in local metres, with cumulative distance for "how far along am I". */
export class Course {
  readonly pts: LatLon[];
  readonly length: number;
  private readonly xy: { x: number; y: number }[];
  private readonly cum: number[];
  private readonly toXY: (p: LatLon) => { x: number; y: number };

  constructor(path: PathPoint[]) {
    this.pts = path.map(([lat, lon]) => ({ lat, lon }));
    this.toXY = localProjector(this.pts[0]).toXY;
    this.xy = this.pts.map(this.toXY);
    this.cum = [0];
    for (let i = 1; i < this.xy.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(this.xy[i].x - this.xy[i - 1].x, this.xy[i].y - this.xy[i - 1].y));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  get start() { return this.pts[0]; }
  get finish() { return this.pts[this.pts.length - 1]; }
  get segments() { return this.pts.length - 1; }

  /** Closest point on the line: distance off course and distance along it. */
  project(p: LatLon, lo = 0, hi = this.segments - 1): { dist: number; s: number; i: number } {
    const q = this.toXY(p);
    let best = { dist: Infinity, s: 0, i: lo };
    for (let i = Math.max(0, lo); i <= Math.min(this.segments - 1, hi); i++) {
      const a = this.xy[i], b = this.xy[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0;
      const d = Math.hypot(a.x + t * dx - q.x, a.y + t * dy - q.y);
      if (d < best.dist) best = { dist: d, s: this.cum[i] + t * Math.sqrt(len2), i };
    }
    return best;
  }
}

/** Time at which the line from a (dist da) to b (dist db) crosses the gate circle. */
function crossing(a: TrackPoint, b: TrackPoint, da: number, db: number, r: number) {
  const u = db === da ? 0 : Math.max(0, Math.min(1, (r - da) / (db - da)));
  return a.t + u * (b.t - a.t);
}

/** Converts (distance along course, elapsed) samples into a fixed-size ghost. */
export function buildGhost(samples: [number, number][], length: number): number[] {
  const out: number[] = [];
  let j = 0;
  for (let k = 0; k <= GHOST_SAMPLES; k++) {
    const target = (k / GHOST_SAMPLES) * length;
    while (j < samples.length - 1 && samples[j][0] < target) j++;
    let t: number;
    if (j === 0 || samples[j][0] <= target) t = samples[j][1];
    else {
      const [s0, t0] = samples[j - 1];
      const [s1, t1] = samples[j];
      t = s1 > s0 ? t0 + ((target - s0) / (s1 - s0)) * (t1 - t0) : t1;
    }
    out.push(Math.round(t * 10) / 10);
  }
  return out;
}

/** Ghost's elapsed time at a fraction (0..1) of the course. */
export function ghostTimeAt(ghost: number[], frac: number): number {
  const x = Math.max(0, Math.min(1, frac)) * (ghost.length - 1);
  const i = Math.floor(x);
  if (i >= ghost.length - 1) return ghost[ghost.length - 1];
  return ghost[i] + (x - i) * (ghost[i + 1] - ghost[i]);
}

export type RaceEvent =
  | { type: 'start'; t: number }
  | { type: 'finish'; startT: number; endT: number; time: number; ghost: number[] }
  | { type: 'abort'; reason: 'off-course' | 'timeout' | 'restart' };

/**
 * Streaming timer for one segment. Feed it GPS fixes in order; it reports
 * start, finish and abort. The same code times live attempts and scans saved days.
 *
 * Timing runs from leaving the start gate circle to entering the finish gate
 * circle, interpolated between fixes, so everyone is timed the same way.
 */
export class Racer {
  readonly course: Course;
  readonly gate: number;
  status: 'idle' | 'armed' | 'racing' = 'idle';
  startT = 0;
  lastT = 0;
  /** Furthest distance along the course so far (m). */
  maxS = 0;
  private prev: TrackPoint | null = null;
  private seg = 0;
  private off = 0;
  private samples: [number, number][] = [];

  constructor(readonly segment: Segment, private readonly maxSeconds = 1800) {
    this.course = new Course(segment.path);
    this.gate = segment.gateRadius || GATE_RADIUS;
  }

  get progress() {
    return this.course.length > 0 ? this.maxS / this.course.length : 0;
  }

  get elapsed() {
    return this.status === 'racing' ? (this.lastT - this.startT) / 1000 : 0;
  }

  push(p: TrackPoint): RaceEvent | null {
    const ev = this.step(p);
    this.prev = p;
    this.lastT = p.t;
    return ev;
  }

  private reset() {
    this.status = 'idle';
    this.maxS = 0;
    this.seg = 0;
    this.off = 0;
    this.samples = [];
  }

  private step(p: TrackPoint): RaceEvent | null {
    const c = this.course;
    const dStart = distance(p, c.start);

    if (this.status === 'idle') {
      if (dStart <= this.gate) this.status = 'armed';
      return null;
    }

    if (this.status === 'armed') {
      if (dStart <= this.gate) return null;
      const prev = this.prev!;
      this.startT = crossing(prev, p, distance(prev, c.start), dStart, this.gate);
      this.status = 'racing';
      this.maxS = 0;
      this.seg = 0;
      this.off = 0;
      this.samples = [[0, 0]];
      return this.track(p) ?? { type: 'start', t: this.startT };
    }

    // Racing. Back in the start gate early on = a fresh start.
    if (dStart <= this.gate && this.maxS < c.length * 0.5) {
      this.reset();
      this.status = 'armed';
      return { type: 'abort', reason: 'restart' };
    }
    return this.track(p);
  }

  private track(p: TrackPoint): RaceEvent | null {
    const c = this.course;
    let pr = c.project(p, this.seg - 3, this.seg + 25);
    if (pr.dist > OFF_COURSE) pr = c.project(p); // re-acquire after a gap
    if (pr.dist > OFF_COURSE) {
      if (++this.off >= OFF_COURSE_FIXES) {
        this.reset();
        return { type: 'abort', reason: 'off-course' };
      }
    } else {
      this.off = 0;
      // Progress can't jump further than you could ski since the last fix (no shortcuts).
      const dt = this.prev ? (p.t - this.prev.t) / 1000 : 0;
      const reachable = this.maxS + 50 + MAX_SPEED * Math.max(0, dt);
      if (pr.s > this.maxS && pr.s <= reachable) {
        this.maxS = pr.s;
        this.seg = pr.i;
        this.samples.push([pr.s, (p.t - this.startT) / 1000]);
      }
    }

    const dFinish = distance(p, c.finish);
    if (dFinish <= this.gate && this.maxS >= c.length * MIN_PROGRESS_TO_FINISH) {
      const prev = this.prev!;
      const endT = crossing(prev, p, distance(prev, c.finish), dFinish, this.gate);
      const time = Math.round((endT - this.startT) / 100) / 10;
      this.samples.push([c.length, time]);
      const ghost = buildGhost(this.samples, c.length);
      const startT = this.startT;
      this.reset();
      // Already inside the finish gate: if it's also the start of a loop, re-arm.
      if (distance(p, c.start) <= this.gate) this.status = 'armed';
      return { type: 'finish', startT, endT, time, ghost };
    }

    if ((p.t - this.startT) / 1000 > this.maxSeconds) {
      this.reset();
      return { type: 'abort', reason: 'timeout' };
    }
    return null;
  }
}

/** Every timed pass through a segment in a recorded day. */
export function findAttempts(points: TrackPoint[], segment: Segment, cleaned = cleanTrack(points)) {
  const racer = new Racer(segment);
  const out: Extract<RaceEvent, { type: 'finish' }>[] = [];
  for (const p of cleaned) {
    const ev = racer.push(p);
    if (ev?.type === 'finish') out.push(ev);
  }
  return out;
}

export interface LeaderboardEntry extends Attempt {
  rank: number;
  attempts: number; // how many times this player has done it
}

/** Best attempt per player, fastest first. */
export function leaderboard(attempts: Attempt[]): LeaderboardEntry[] {
  const best = new Map<string, Attempt>();
  const counts = new Map<string, number>();
  for (const a of attempts) {
    counts.set(a.playerId, (counts.get(a.playerId) ?? 0) + 1);
    const cur = best.get(a.playerId);
    if (!cur || a.time < cur.time || (a.time === cur.time && a.at < cur.at)) best.set(a.playerId, a);
  }
  return [...best.values()]
    .sort((a, b) => a.time - b.time || a.at - b.at)
    .map((a, i) => ({ ...a, rank: i + 1, attempts: counts.get(a.playerId) ?? 1 }));
}

/** Time a live attempt should be compared against: the leader, or your own PB if you lead. */
export function pickTarget(attempts: Attempt[], myId: string): { name: string; ghost: number[]; time: number; mine: boolean } | null {
  const board = leaderboard(attempts).filter((e) => e.ghost && e.ghost.length === GHOST_SAMPLES + 1);
  const leader = board[0];
  if (!leader) return null;
  return { name: leader.playerName, ghost: leader.ghost!, time: leader.time, mine: leader.playerId === myId };
}
