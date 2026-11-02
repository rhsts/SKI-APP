import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { kvGet, kvSet, loadSettings, sessionStarts } from '../db';
import { skiAreas } from '../lib/areas';
import { readActive } from './task';

/**
 * Auto-start reminder: a geofence around each ski area you've skied before.
 * When you arrive at one and aren't recording, you get a notification:
 * "At Ischgl? Tap to start recording your ski day."
 */
export const GEOFENCE_TASK = 'ski-area-geofence';
const MAX_REGIONS = 20; // keep well under Android's limit of 100
const RADIUS_M = 3000;
const QUIET_MS = 12 * 3600 * 1000; // at most one reminder per area per day

if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
  TaskManager.defineTask<{ eventType: Location.GeofencingEventType; region: Location.LocationRegion }>(
    GEOFENCE_TASK,
    async ({ data, error }) => {
      if (error || !data || data.eventType !== Location.GeofencingEventType.Enter) return;
      const active = await readActive();
      if (active && !active.paused) return; // already recording
      const id = data.region.identifier ?? 'area';
      const key = `remind:${id}`;
      const last = Number((await kvGet(key)) ?? 0);
      if (Date.now() - last < QUIET_MS) return;
      await kvSet(key, String(Date.now()));
      const name = id.split('|')[0];
      await Notifications.scheduleNotificationAsync({
        content: { title: `At ${name}? 🎿`, body: 'Tap to start recording your ski day.' },
        trigger: null,
      });
    },
  );
}

/** Sets the geofences to the ski areas you've visited (or removes them when the setting is off). */
export async function refreshGeofences(): Promise<number> {
  const { remindStart } = await loadSettings();
  const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);
  if (!remindStart) {
    if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    return 0;
  }
  const areas = skiAreas((await sessionStarts()).filter((s) => !s.isDemo)).slice(0, MAX_REGIONS);
  if (!areas.length) {
    if (started) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    return 0;
  }
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    areas.map((a, i) => ({
      identifier: `${a.name}|${i}`,
      latitude: a.lat,
      longitude: a.lon,
      radius: RADIUS_M,
      notifyOnEnter: true,
      notifyOnExit: false,
    })),
  );
  return areas.length;
}

/** Asks for the permissions reminders need. Returns a reason if one was refused. */
export async function requestReminderPermissions(): Promise<string | null> {
  const n = await Notifications.requestPermissionsAsync();
  if (!n.granted) return 'Notifications are needed to remind you.';
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'Location access is needed to know when you arrive at a ski area.';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return 'Allow location “All the time” so the app can notice you arriving while it’s closed.';
  return null;
}

/** Show reminders as banners even when the app is open. */
export function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}
