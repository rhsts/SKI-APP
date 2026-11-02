import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';
import {
  createSession, deleteSession, finishSession, getPoints, insertPoints, kvSet, listAttempts, listSegments, upsertAttempts,
} from '../db';
import { simulateDay } from '../lib/sim';
import { computeStats, smoothedSpeeds, cleanTrack } from '../lib/stats';
import type { DayStats, TrackPoint } from '../lib/types';
import { matchSession, myAttempt } from '../challenges/service';
import { ghostTimeAt, leaderboard, pickTarget, Racer } from '../lib/segments';
import { getSettings } from '../settings';
import { lookupPlace } from './place';
import { LOCATION_TASK, readActive, toTrackPoint, type ActiveSession } from './task';

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
}

const initial: TrackerState = {
  status: 'idle', active: null, points: [], stats: null, currentSpeed: 0, lastFixAt: null,
  foregroundOnly: false, recovered: false, error: null, race: null, finish: null,
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
  set({ points, stats, currentSpeed: spd[spd.length - 1] ?? 0, lastFixAt: fresh[fresh.length - 1].t });
  feedRacers(fresh, a.sessionId);
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
    const day = simulateDay({ start: a.startedAt, runs: 4, seed: a.startedAt % 1000 }).points;
    let i = already;
    simTimer = setInterval(() => {
      if (i >= day.length) return;
      const chunk = day.slice(i, i + SIM_POINTS_PER_TICK);
      i += chunk.length;
      insertPoints(a.sessionId, chunk).catch((e) => set({ error: String(e) }));
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
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') throw new Error('no background permission');
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      ...options,
      activityType: Location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Tracking your ski day',
        notificationBody: 'Speed, vertical and runs are being recorded.',
        notificationColor: '#0B6BCB',
        killServiceOnDestroy: false,
      },
    });
    set({ foregroundOnly: false });
  } catch {
    // Expo Go on iOS, or "Allow all the time" refused: track while the app is open
    // and keep the screen awake so the phone doesn't stop GPS.
    watchSub = await Location.watchPositionAsync(options, (loc) => {
      insertPoints(a.sessionId, [toTrackPoint(loc)]).catch((e) => set({ error: String(e) }));
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

export function dismissFinish() {
  set({ finish: null });
}

// ---------- actions ----------

export async function startDay(simulate: boolean): Promise<void> {
  if (state.status !== 'idle') return;
  set({ error: null });
  const startedAt = Date.now();
  const sessionId = await createSession(startedAt, simulate);
  const active: ActiveSession = { sessionId, startedAt, paused: false, source: simulate ? 'sim' : 'gps' };
  await saveActive(active);
  set({ ...initial, status: 'recording', active });
  racers = [];
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
    await refreshRacers();
    startPolling();
    return;
  }
  const paused = { ...a, paused: true };
  await saveActive(paused);
  set({ ...initial, status: 'paused', active: paused, points, stats, recovered: !a.paused });
}
