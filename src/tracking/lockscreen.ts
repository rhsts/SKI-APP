import { Platform } from 'react-native';
import { loadSettings } from '../db';
import { lockScreenText } from '../lib/lockscreen';
import type { DayStats } from '../lib/types';
import type { ActiveSession } from './task';

/**
 * The day on the Android lock screen while recording: the notification of the location
 * foreground service (expo-location/next). Posting it again doesn't restart GPS, and works
 * with the app in the background.
 *
 * The native module is loaded on first use (it doesn't exist on the web), and nothing in here
 * throws: the lock screen must never break recording.
 */

/** At most one refresh a minute, so the battery doesn't notice. */
export const LOCK_SCREEN_EVERY_MS = 60 * 1000;
let shownAt = 0;

/** True once the notification is a minute old. The GPS task checks this on every batch. */
export function lockScreenDue(now = Date.now()): boolean {
  return now - shownAt >= LOCK_SCREEN_EVERY_MS;
}

let loading: Promise<typeof import('expo-location/next') | null> | undefined;
const locationNext = () => (loading ??= import('expo-location/next').catch(() => null));

async function notification(active: ActiveSession, stats: DayStats | null) {
  const { units } = await loadSettings();
  const { title, body } = lockScreenText(stats, { startedAt: active.startedAt, paused: active.paused, units, now: Date.now() });
  return { notificationTitle: title, notificationBody: body, notificationColor: 0x0b6bcb };
}

/**
 * Starts the service that keeps GPS coming with the screen off; its notification shows the
 * day. Only works from the foreground. False when it didn't start: the caller then lets
 * expo-location run its own service, with a fixed text.
 */
export async function startTrackingService(active: ActiveSession, stats: DayStats | null): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const next = await locationNext();
    if (!next) return false;
    // Android 13+: without this permission the service still runs, but its notification is hidden.
    await next.Location.requestNotificationPermissions().catch(() => undefined);
    await next.Location.ensureBackgroundSessionStarted(await notification(active, stats));
    shownAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

/** Recording is over (or GPS is off): stops the service and takes its notification away. */
export async function stopTrackingService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await (await locationNext())?.Location.stopBackgroundSession();
  } catch {
    // Not running.
  }
}

/** Refreshes the notification of the running service. Never starts one. True when it's showing. */
export async function showLockScreen(active: ActiveSession, stats: DayStats | null): Promise<boolean> {
  shownAt = Date.now();
  if (Platform.OS !== 'android') return false;
  try {
    const next = await locationNext();
    if (!next || next.Location.getBackgroundSessionStatus().state === next.BackgroundSessionState.NOT_RUNNING) return false;
    await next.Location.ensureBackgroundSessionStarted(await notification(active, stats));
    return true;
  } catch {
    return false;
  }
}
