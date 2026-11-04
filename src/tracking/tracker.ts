import * as Battery from 'expo-battery';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';
import {
  createSession, deleteMotionEvent, deleteSession, finishSession, getPoints, insertMotionEvents, insertPoints, kvGet, kvSet,
  listAttempts, listMotionEvents, listSegments, upsertAttempts,
} from '../db';
import { EMPTY_MOTION, summariseMotion, type MotionEvent, type MotionSummary } from '../lib/motion';
import { startMotion, stopMotion } from './motion';
import { simulateDay } from '../lib/sim';
import { cleanTrack, completedRuns, computeStats, smoothedSpeeds } from '../lib/stats';
import type { DayStats, TrackPoint } from '../lib/types';
import { matchSession, myAttempt } from '../challenges/service';
import { ghostTimeAt, leaderboard, pickTarget, Racer } from '../lib/segments';
import { getSettings } from '../settings';
import { compareSplits, SECTION_NAMES } from '../lib/ghost';
import { AUTO_PAUSE_MS, batteryHoursLeft, restingFor } from '../lib/power';
import type { Sport } from '../lib/sport';
import { readPressure, startBarometer, stopBarometer } from './barometer';
import { lookupPistes } from '../mountain/pistes';
import { refreshGeofences } from './geofence';
import { lookupPlace } from './place';
import { LOCATION_TASK, locationTaskOptions, readActive, resetGpsState, toTrackPoint, type ActiveSession } from './task';

/**
 * Recording state shared by every screen. GPS fixes go GPS → SQLite (via the
 * background task) and the UI polls SQLite once a second, so the screen shows
 * exactly what is saved, including fixes received while the app was in the
 * background.
 */

export type TrackerStatus = 'idle' | 'recording' | 'paused';

export interface TrackerState {
  status: TrackerStatus;
  active: ActiveSession | null;
  points: TrackPoint[];
  stats: DayStats | null;
  currentSpeed: number; // m/s
  lastFixAt: number | null;
  /** True when we fell back to foreground-only GPS (screen kept awake). */
  foregroundOnly: boolean;
  /** An unfinished day found at launch that the user should resume or finish. */
  recovered: boolean;
  error: string | null;
  /** A challenge you're skiing right now. */
  race: LiveRace | null;
  /** The challenge you just finished, shown until dismissed. */
  finish: RaceFinish | null;
  /** The run you just finished, shown on the Record screen. */
  lastRun: RunSummary | null;
  /** A new top speed for the day, shown for a few seconds. */
  newTop: { speed: number; at: number } | null;
  /** Standing still for 10+ minutes: GPS is sleeping until you move. */
  autoPaused: boolean;
  /** Battery level (0..1) and estimated hours of tracking left. */
  battery: { level: number; hoursLeft: number | null } | null;
  /** Jumps and falls so far today. */
  motion: MotionSummary;
  /** The motion sensor is listening (app open, setting on). */
  motionLive: boolean;
  /** A jump you just landed, shown for a few seconds. */
  jump: { airtime: number; at: number } | null;
  /** A fall was detected: ask if you're OK. */
  fallAlert: { t: number; peak: number } | null;
}

export interface RunSummary {
  number: number;
  topSpeed: number;
  verticalDown: number;
  distance: number;
  duration: number;
}

export interface LiveRace {
  segmentId: string;
  name: string;
  elapsed: number; // s
  progress: number; // 0..1
  rivalName: string | null;
  rivalIsMe: boolean;
  /** Seconds behind (+) or ahead (−) of the rival's ghost at this point of the course. */
  delta: number | null;
}

export interface RaceFinish {
  segmentId: string;
  name: string;
  time: number;
  rank: number;
  of: number;
  isPersonalBest: boolean;
  previousBest: number | null;
  /** The rival you were chasing, and your gap to their time (negative = you beat them). */
  rivalName: string | null;
  rivalIsMe: boolean;
  rivalGap: number | null;
  /** Where the time was won or lost against the rival, e.g. "Lost 1.8s in the middle section". */
  splitNote: string | null;
}

const initial: TrackerState = {
  status: 'idle', active: null, points: [], stats: null, currentSpeed: 0, lastFixAt: null,
  foregroundOnly: false, recovered: false, error: null, race: null, finish: null,
  lastRun: null, newTop: null, battery: null, autoPaused: false,
  motion: EMPTY_MOTION, motionLive: false, jump: null, fallAlert: null,
};

let state = initial;
const listeners = new Set<() => void>();
function set(patch: Partial<TrackerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useTracker(): TrackerState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

// ---------- polling the DB for new fixes ----------

let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastStatsAt = 0;
let polling = false;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    await pollOnce();
  } finally {
    polling = false;
  }
}

async function pollOnce() {
  const a = state.active;
  if (!a) return;
  const lastT = state.points.length ? state.points[state.points.length - 1].t : -1;
  const fresh = await getPoints(a.sessionId, lastT);
  if (!fresh.length || state.active?.sessionId !== a.sessionId) return;
  const points = state.points.concat(fresh);
  // Live stats: recompute at most every second, every 3 s once the day gets long.
  const now = Date.now();
  const every = points.length > 6000 ? 3000 : 1000;
  let stats = state.stats;
  if (!stats || now - lastStatsAt >= every) {
    stats = computeStats(points);
    lastStatsAt = now;
  }
  const tail = cleanTrack(points.slice(-8));
  const spd = tail.length ? smoothedSpeeds(tail) : [0];
  set({
    points, stats, currentSpeed: spd[spd.length - 1] ?? 0, lastFixAt: fresh[fresh.length - 1].t,
    autoPaused: restingFor(points.slice(-900)) >= AUTO_PAUSE_MS,
  });
  feedRacers(fresh, a.sessionId);
  checkMoments(stats);
  if (now - lastBatteryAt > 60000) {
    lastBatteryAt = now;
    updateBattery().catch(() => undefined);
  }
}

// ---------- moments: run finished, new top speed, battery ----------

let announcedRuns = 0;
let bestTop = 0;
let lastBatteryAt = 0;
let newTopTimer: ReturnType<typeof setTimeout> | null = null;

/** Start counting from the current state so recovering a day doesn't replay old moments. */
function resetMoments(stats: DayStats | null) {
  announcedRuns = stats ? completedRuns(stats).length : 0;
  bestTop = stats?.topSpeed ?? 0;
  lastBatteryAt = 0;
}


function buzz(kind: 'success' | 'tap' | 'warning') {
  // A fall warning always buzzes: it's a safety check, not a gimmick.
  if (!getSettings().vibrate && kind !== 'warning') return;
  const p = kind === 'success'
    ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : kind === 'warning'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  p.catch(() => undefined);
}

// ---------- jumps and falls ----------

let jumpTimer: ReturnType<typeof setTimeout> | null = null;
const MIN_MOVING_SPEED = 3; // m/s: jumps and falls only count while you're skiing

/** Fastest speed recorded between two times, from the fixes we have. */
function speedAround(from: number, to: number): number {
  let top = 0;
  const pts = state.points;
  for (let i = pts.length - 1; i >= 1 && pts[i].t >= from; i--) {
    const p = pts[i];
    if (p.t > to) continue;
    const q = pts[i - 1];
    const v = p.spd ?? (p.t > q.t ? Math.hypot(p.lat - q.lat, (p.lon - q.lon) * Math.cos((p.lat * Math.PI) / 180)) * 111320 / ((p.t - q.t) / 1000) : 0);
    if (v > top && v < 45) top = v;
  }
  return top;
}

function positionAt(t: number): { lat: number | null; lon: number | null } {
  const pts = state.points;
  let best = pts[pts.length - 1];
  for (let i = pts.length - 1; i >= 0; i--) {
    if (Math.abs(pts[i].t - t) < Math.abs(best.t - t)) best = pts[i];
    if (pts[i].t < t - 5000) break;
  }
  return best ? { lat: best.lat, lon: best.lon } : { lat: null, lon: null };
}

async function onMotion(e: MotionEvent, sessionId: string, pos?: { lat: number; lon: number }) {
  if (state.active?.sessionId !== sessionId) return;
  // Phone dropped at the lift, sat down hard on a bench: only count it while skiing.
  if (!pos && speedAround(e.t - 8000, e.t + 3000) < MIN_MOVING_SPEED) return;
  const where = pos ?? positionAt(e.t);
  await insertMotionEvents(sessionId, [{ ...e, ...where }]);
  const m = { ...state.motion };
  if (e.kind === 'jump') {
    m.jumps++;
    m.totalAir += e.value;
    m.bestAir = Math.max(m.bestAir, e.value);
    set({ motion: m, jump: { airtime: e.value, at: e.t } });
    buzz('tap');
    if (jumpTimer) clearTimeout(jumpTimer);
    jumpTimer = setTimeout(() => set({ jump: null }), 6000);
  } else {
    m.falls++;
    set({ motion: m, fallAlert: getSettings().fallCheck ? { t: e.t, peak: e.value } : state.fallAlert });
    buzz('warning');
  }
}

async function startMotionSensor(a: ActiveSession) {
  if (!getSettings().motion) return;
  const ok = await startMotion((e) => { onMotion(e, a.sessionId).catch((err) => set({ error: String(err) })); });
  set({ motionLive: ok });
}

async function loadMotion(sessionId: string) {
  const events = await listMotionEvents(sessionId).catch(() => []);
  set({ motion: summariseMotion(events) });
}

/** "I'm OK": close the fall check. The fall stays in your stats. */
export function dismissFall() {
  set({ fallAlert: null });
}

/** It wasn't a fall: close the check and take it out of the stats. */
export async function notAFall(): Promise<void> {
  const f = state.fallAlert;
  const a = state.active;
  set({ fallAlert: null });
  if (!f || !a) return;
  await deleteMotionEvent(a.sessionId, f.t, 'fall');
  set({ motion: { ...state.motion, falls: Math.max(0, state.motion.falls - 1) } });
}

function checkMoments(stats: DayStats) {
  const done = completedRuns(stats);
  if (done.length > announcedRuns) {
    const r = done[done.length - 1];
    announcedRuns = done.length;
    set({
      lastRun: { number: done.length, topSpeed: r.topSpeed, verticalDown: r.verticalDown, distance: r.distance, duration: r.duration },
    });
    buzz('tap');
  }
  // A new top speed: only once it beats the old one by ~1 km/h, and not for slow starts.
  if (stats.topSpeed > bestTop + 0.3 && stats.topSpeed > 8) {
    const first = bestTop === 0;
    bestTop = stats.topSpeed;
    if (!first) {
      set({ newTop: { speed: stats.topSpeed, at: Date.now() } });
      buzz('success');
      if (newTopTimer) clearTimeout(newTopTimer);
      newTopTimer = setTimeout(() => set({ newTop: null }), 8000);
    }
  } else if (stats.topSpeed > bestTop) {
    bestTop = stats.topSpeed;
  }
}

export function dismissLastRun() {
  set({ lastRun: null });
}

async function updateBattery() {
  const level = await Battery.getBatteryLevelAsync();
  if (!(level >= 0)) return; // -1 when unknown (e.g. emulator)
  let start: { level: number; t: number } | null = null;
  try {
    start = JSON.parse((await kvGet('batteryStart')) ?? 'null');
  } catch {
    start = null;
  }
  // Charging or a fresh start: measure the drain from here.
  if (!start || level > start.level) {
    start = { level, t: Date.now() };
    await kvSet('batteryStart', JSON.stringify(start));
  }
  set({ battery: { level, hoursLeft: batteryHoursLeft(start.level, start.t, level, Date.now()) } });
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { poll().catch((e) => set({ error: String(e) })); }, 1000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---------- position sources ----------

let watchSub: Location.LocationSubscription | null = null;
let simTimer: ReturnType<typeof setInterval> | null = null;

const SIM_POINTS_PER_TICK = 20; // 20 simulated seconds per real second

async function startSource(a: ActiveSession): Promise<void> {
  if (a.source === 'sim') {
    // Continue the fake day from where it was, or start a new one.
    const already = state.points.length;
    const sim = simulateDay({ start: a.startedAt, runs: 4, seed: a.startedAt % 1000, barometer: true, turns: true });
    const day = sim.points;
    let i = already;
    simTimer = setInterval(() => {
      if (i >= day.length) return;
      const chunk = day.slice(i, i + SIM_POINTS_PER_TICK);
      i += chunk.length;
      const from = chunk[0].t, to = chunk[chunk.length - 1].t;
      insertPoints(a.sessionId, chunk)
        .then(async () => {
          // The fake day's jumps and falls, as if the motion sensor had felt them.
          for (const e of sim.motion.filter((m) => m.t >= from && m.t <= to)) {
            const p = chunk.reduce((b, q) => (Math.abs(q.t - e.t) < Math.abs(b.t - e.t) ? q : b), chunk[0]);
            await onMotion(e, a.sessionId, { lat: p.lat, lon: p.lon });
          }
        })
        .catch((e) => set({ error: String(e) }));
    }, 1000);
    return;
  }

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new Error('Location permission is needed to track your day.');
  const options = {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 2,
  };
  await startBarometer();
  await startMotionSensor(a);
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') throw new Error('no background permission');
    await resetGpsState();
    await Location.startLocationUpdatesAsync(LOCATION_TASK, locationTaskOptions('precise'));
    set({ foregroundOnly: false });
  } catch {
    // Expo Go on iOS, or "Allow all the time" refused: track while the app is open
    // and keep the screen awake so the phone doesn't stop GPS.
    watchSub = await Location.watchPositionAsync(options, (loc) => {
      readPressure()
        .then((pres) => insertPoints(a.sessionId, [{ ...toTrackPoint(loc), pres }]))
        .catch((e) => set({ error: String(e) }));
    });
    await activateKeepAwakeAsync('ski-tracking');
    set({ foregroundOnly: true });
  }
}

async function stopSource(): Promise<void> {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  watchSub?.remove();
  watchSub = null;
  stopBarometer();
  stopMotion();
  set({ motionLive: false, jump: null });
  deactivateKeepAwake('ski-tracking');
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Task was never registered (e.g. sim only) — nothing to stop.
  }
}

async function saveActive(a: ActiveSession | null) {
  await kvSet('active', a ? JSON.stringify(a) : null);
}

// ---------- live challenge timing ----------

interface LiveRacer {
  racer: Racer;
  target: ReturnType<typeof pickTarget>;
}

let racers: LiveRacer[] = [];

/** (Re)loads the challenges to time while recording. Call after creating or importing one. */
export async function refreshRacers(): Promise<void> {
  const segments = (await listSegments()).filter((s) => s.path.length >= 2);
  const attempts = await listAttempts();
  const me = getSettings().playerId;
  const keep = new Map(racers.map((r) => [r.racer.segment.id, r.racer]));
  racers = segments.map((seg) => ({
    racer: keep.get(seg.id) ?? new Racer(seg),
    target: pickTarget(attempts.filter((a) => a.segmentId === seg.id), me),
  }));
}

async function onFinish(lr: LiveRacer, sessionId: string, ev: { startT: number; time: number; ghost: number[] }) {
  const seg = lr.racer.segment;
  const me = getSettings().playerId;
  const before = await listAttempts(seg.id);
  const prevBest = before.filter((a) => a.playerId === me).reduce<number | null>((m, a) => (m == null || a.time < m ? a.time : m), null);
  const attempt = myAttempt(seg, sessionId, ev);
  await upsertAttempts([attempt]);
  const board = leaderboard([...before.filter((a) => a.id !== attempt.id), attempt]);
  const mine = board.find((e) => e.playerId === me)!;
  const target = lr.target;
  set({
    finish: {
      segmentId: seg.id,
      name: seg.name,
      time: ev.time,
      rank: mine.rank,
      of: board.length,
      isPersonalBest: prevBest == null || ev.time < prevBest,
      previousBest: prevBest,
      rivalName: target ? target.name : null,
      rivalIsMe: target?.mine ?? false,
      rivalGap: target ? ev.time - target.time : null,
      splitNote: target ? splitNote(ev.ghost, target.ghost) : null,
    },
  });
  lr.target = pickTarget([...before, attempt], me);
}

function feedRacers(fresh: TrackPoint[], sessionId: string) {
  if (!racers.length) return;
  for (const p of fresh) {
    if (p.acc != null && p.acc > 40) continue;
    for (const lr of racers) {
      const ev = lr.racer.push(p);
      if (ev?.type === 'finish') onFinish(lr, sessionId, ev).catch((e) => set({ error: String(e) }));
    }
  }
  // Show the race you're furthest into.
  const active = racers
    .filter((lr) => lr.racer.status === 'racing')
    .sort((a, b) => b.racer.progress - a.racer.progress)[0];
  if (!active) {
    if (state.race) set({ race: null });
    return;
  }
  const { racer, target } = active;
  set({
    race: {
      segmentId: racer.segment.id,
      name: racer.segment.name,
      elapsed: racer.elapsed,
      progress: racer.progress,
      rivalName: target?.name ?? null,
      rivalIsMe: target?.mine ?? false,
      delta: target ? racer.elapsed - ghostTimeAt(target.ghost, racer.progress) : null,
    },
  });
}

function splitNote(mine: number[], theirs: number[]): string | null {
  const c = compareSplits(mine, theirs);
  if (c.worst != null && c.deltas[c.worst] >= 0.5) return `Lost ${c.deltas[c.worst].toFixed(1)}s in the ${SECTION_NAMES[c.worst]} section.`;
  if (c.best != null && c.deltas[c.best] <= -0.5) return `Gained ${Math.abs(c.deltas[c.best]).toFixed(1)}s in the ${SECTION_NAMES[c.best]} section.`;
  return null;
}

export function dismissFinish() {
  set({ finish: null });
}

// ---------- actions ----------

export async function startDay(simulate: boolean, sport: Sport = 'ski'): Promise<void> {
  if (state.status !== 'idle') return;
  set({ error: null });
  const startedAt = Date.now();
  const sessionId = await createSession(startedAt, simulate, sport);
  const active: ActiveSession = { sessionId, startedAt, paused: false, source: simulate ? 'sim' : 'gps' };
  await saveActive(active);
  set({ ...initial, status: 'recording', active });
  racers = [];
  resetMoments(null);
  await kvSet('batteryStart', null);
  try {
    await refreshRacers();
    await startSource(active);
    startPolling();
  } catch (e) {
    await saveActive(null);
    await deleteSession(sessionId);
    set({ ...initial, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function pauseDay(): Promise<void> {
  if (state.status !== 'recording' || !state.active) return;
  await stopSource();
  await poll();
  stopPolling();
  const active = { ...state.active, paused: true };
  await saveActive(active);
  set({ status: 'paused', active, currentSpeed: 0 });
}

export async function resumeDay(): Promise<void> {
  if (!state.active || state.status === 'recording') return;
  const active = { ...state.active, paused: false };
  await saveActive(active);
  set({ status: 'recording', active, recovered: false, error: null });
  resetMoments(state.stats);
  try {
    await refreshRacers();
    await startSource(active);
    startPolling();
  } catch (e) {
    await saveActive({ ...active, paused: true });
    set({ status: 'paused', active: { ...active, paused: true }, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Ends the day: computes final stats, looks up where you were and saves it.
 * Returns the saved session id, or null if it was too short to keep.
 */
export async function stopDay(): Promise<string | null> {
  const a = state.active;
  if (!a) return null;
  await stopSource();
  stopPolling();
  const points = await getPoints(a.sessionId);
  await saveActive(null);
  const stats = computeStats(points);
  if (points.length < 20 || stats.duration < 60) {
    await deleteSession(a.sessionId);
    racers = [];
    set({ ...initial });
    return null;
  }
  const place = a.source === 'sim' ? 'Demo Mountain' : await lookupPlace(points);
  await finishSession(a.sessionId, points[points.length - 1].t, stats, place);
  // Re-time all challenges on the complete day (catches anything missed live).
  await matchSession(a.sessionId, points);
  // Piste names in the background; the day screen retries if this fails (e.g. no signal).
  if (a.source === 'gps') {
    lookupPistes(a.sessionId).catch(() => undefined);
    // A new ski area may need a reminder geofence.
    refreshGeofences().catch(() => undefined);
  }
  racers = [];
  set({ ...initial });
  return a.sessionId;
}

/** Called once at launch: picks up a day that was still recording when the app was closed. */
export async function recoverActiveDay(): Promise<void> {
  const a = await readActive();
  if (!a) return;
  const points = await getPoints(a.sessionId);
  const stats = points.length ? computeStats(points) : null;
  let bgRunning = false;
  try {
    bgRunning = a.source === 'gps' && (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK));
  } catch {
    bgRunning = false;
  }
  if (!a.paused && bgRunning) {
    // The background service kept recording while the UI was gone: just reattach.
    set({ ...initial, status: 'recording', active: a, points, stats });
    resetMoments(stats);
    await loadMotion(a.sessionId);
    await refreshRacers();
    startPolling();
    if (getSettings().motion) await startMotionSensor(a);
    return;
  }
  const paused = { ...a, paused: true };
  await saveActive(paused);
  set({ ...initial, status: 'paused', active: paused, points, stats, recovered: !a.paused });
  await loadMotion(a.sessionId);
}
