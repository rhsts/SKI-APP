import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getPoints, insertPoints, kvGet, kvSet } from '../db';
import { decideGpsMode, GPS_OPTIONS, type GpsMode } from '../lib/power';
import { computeStats } from '../lib/stats';
import { readPressure } from './barometer';
import { lockScreenDue, showLockScreen } from './lockscreen';
import { prefetchTrailMap } from '../mountain/pistes';
import type { TrackPoint } from '../lib/types';

/**
 * Background location task. It must be defined at module scope and imported
 * from the root layout, so it is registered even when Android wakes the app
 * headless to deliver locations while the screen is off.
 */
export const LOCATION_TASK = 'ski-location-updates';

export interface ActiveSession {
  sessionId: string;
  startedAt: number;
  paused: boolean;
  source: 'gps' | 'sim';
}

export async function readActive(): Promise<ActiveSession | null> {
  const raw = await kvGet('active');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveSession;
  } catch {
    return null;
  }
}

export function toTrackPoint(l: Location.LocationObject): TrackPoint {
  const c = l.coords;
  return {
    t: l.timestamp,
    lat: c.latitude,
    lon: c.longitude,
    alt: c.altitude ?? null,
    acc: c.accuracy ?? null,
    spd: c.speed != null && c.speed >= 0 ? c.speed : null,
  };
}

/** A fix this long before Start is a cached one (the hotel, the car park): not part of the day. */
const STALE_BEFORE_START_MS = 60_000;
/** A fix stamped this far ahead of the phone's clock has a broken time. */
const MAX_FUTURE_MS = 5 * 60_000;

/**
 * Drops fixes whose time can't belong to this day. Android can hand over its last known
 * position (often hours old and far away) as the first fix, and some GPS chips report broken
 * times. Kept, a stale fix stretches the day's duration and distance, and a fix from the
 * future stops the Record screen from showing any newer fix for the rest of the day.
 */
export function plausibleFixes<P extends { t: number }>(pts: P[], startedAt: number, now = Date.now()): P[] {
  return pts.filter((p) => Number.isFinite(p.t) && p.t >= startedAt - STALE_BEFORE_START_MS && p.t <= now + MAX_FUTURE_MS);
}

/**
 * Options for background location updates in a given battery mode.
 * `ownService`: Android only. expo-location runs its own foreground service, with a fixed
 * notification. Only needed when the service behind the lock-screen notification
 * (lockscreen.ts) couldn't start; the two must never run together.
 */
export function locationTaskOptions(mode: GpsMode, ownService = true): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.BestForNavigation,
    ...GPS_OPTIONS[mode],
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    ...(ownService ? {
      foregroundService: {
        notificationTitle: 'Tracking your ski day',
        notificationBody: 'Speed, vertical and runs are being recorded.',
        notificationColor: '#0B6BCB',
        killServiceOnDestroy: false,
      },
    } : {}),
  };
}

interface GpsState {
  mode: GpsMode;
  /** See locationTaskOptions. Missing in a state saved by an older version, which always had it. */
  ownService?: boolean;
}

export async function resetGpsState(ownService = true) {
  await kvSet('gps', JSON.stringify({ mode: 'precise', ownService } satisfies GpsState));
}

/**
 * Battery saver: after each batch, switch between precise and eco GPS by re-issuing
 * startLocationUpdatesAsync with new options.
 * With `ownService`, Android refuses that while the app is in the background (a foreground
 * service can't be started from there), so the mode then only changes while the app is open.
 */
async function adapt(sessionId: string, lastT: number) {
  let st: GpsState;
  try {
    st = JSON.parse((await kvGet('gps')) ?? '');
  } catch {
    st = { mode: 'precise' };
  }
  // 11 minutes of history: enough to notice a 10-minute break (auto-pause).
  const recent = await getPoints(sessionId, lastT - 11 * 60000);
  const mode = decideGpsMode(recent, st.mode);
  if (mode === st.mode) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, locationTaskOptions(mode, st.ownService !== false));
  await kvSet('gps', JSON.stringify({ ...st, mode } satisfies GpsState));
}

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const active = await readActive();
    if (!active || active.paused || active.source !== 'gps') return;
    const pts = plausibleFixes(data.locations.map(toTrackPoint), active.startedAt);
    if (!pts.length) return;
    const pres = await readPressure();
    for (const p of pts) p.pres = pres;
    await insertPoints(active.sessionId, pts);
    const last = pts[pts.length - 1];
    prefetchTrailMap(last.lat, last.lon, last.t).catch(() => undefined); // no await: never hold up recording
    try {
      await adapt(active.sessionId, pts[pts.length - 1].t);
    } catch {
      // Never let battery-saver logic break recording.
    }
    // The notification on the lock screen, once a minute. From here, because this task also
    // runs with the app in the background, where nothing else does.
    try {
      if (lockScreenDue()) await showLockScreen(active, computeStats(await getPoints(active.sessionId)));
    } catch {
      // Nor the lock screen.
    }
  });
}
