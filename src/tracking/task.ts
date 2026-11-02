import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { insertPoints, kvGet } from '../db';
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

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const active = await readActive();
    if (!active || active.paused || active.source !== 'gps') return;
    await insertPoints(active.sessionId, data.locations.map(toTrackPoint));
  });
}
