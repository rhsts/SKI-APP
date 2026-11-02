import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getPoints, insertPoints, kvGet, kvSet, loadSettings } from '../db';
import { fmtAlt, fmtSpeed } from '../lib/format';
import { decideGpsMode, GPS_OPTIONS, notificationBody, type GpsMode } from '../lib/power';
import { computeStats } from '../lib/stats';
import { readPressure } from './barometer';
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

export const DEFAULT_NOTIFICATION = 'Speed, vertical and runs are being recorded.';

/** Options for the background location service in a given battery mode. */
export function locationTaskOptions(mode: GpsMode, body = DEFAULT_NOTIFICATION): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.BestForNavigation,
    ...GPS_OPTIONS[mode],
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Tracking your ski day',
      notificationBody: body,
      notificationColor: '#0B6BCB',
      killServiceOnDestroy: false,
    },
  };
}

interface GpsState {
  mode: GpsMode;
  body: string;
  notifiedAt: number;
}

const NOTIFY_EVERY_MS = 3 * 60 * 1000;

export async function resetGpsState() {
  await kvSet('gps', JSON.stringify({ mode: 'precise', body: DEFAULT_NOTIFICATION, notifiedAt: Date.now() } satisfies GpsState));
}

/**
 * Battery saver + live notification: after each batch, switch between precise and
 * eco GPS, and every few minutes refresh the notification with the day's stats.
 * Both are done by re-issuing startLocationUpdatesAsync with new options.
 */
async function adapt(sessionId: string, lastT: number) {
  let st: GpsState;
  try {
    st = JSON.parse((await kvGet('gps')) ?? '');
  } catch {
    st = { mode: 'precise', body: DEFAULT_NOTIFICATION, notifiedAt: 0 };
  }
  const recent = await getPoints(sessionId, lastT - 60000);
  const mode = decideGpsMode(recent, st.mode);
  const now = Date.now();
  const notify = now - st.notifiedAt >= NOTIFY_EVERY_MS;
  if (mode === st.mode && !notify) return;
  let body = st.body;
  if (notify) {
    const { units } = await loadSettings();
    const stats = computeStats(await getPoints(sessionId));
    body = notificationBody(stats, { alt: (m) => fmtAlt(m, units), speed: (v) => fmtSpeed(v, units) });
  }
  await Location.startLocationUpdatesAsync(LOCATION_TASK, locationTaskOptions(mode, body));
  await kvSet('gps', JSON.stringify({ mode, body, notifiedAt: notify ? now : st.notifiedAt } satisfies GpsState));
}

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const active = await readActive();
    if (!active || active.paused || active.source !== 'gps') return;
    const pres = await readPressure();
    const pts = data.locations.map((l) => ({ ...toTrackPoint(l), pres }));
    await insertPoints(active.sessionId, pts);
    try {
      await adapt(active.sessionId, pts[pts.length - 1].t);
    } catch {
      // Never let battery-saver logic break recording.
    }
  });
}
