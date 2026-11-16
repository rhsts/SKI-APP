import * as Notifications from 'expo-notifications';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { kvGet, kvSet } from '../db';
import type { LatLon } from '../lib/geo';
import type { LiveMember, Pin } from '../lib/groups';
import { pinText, unseenPins } from '../lib/meet';
import { getSettings } from '../settings';
import { api, FriendsError, friendsEnabled } from './api';
import { cachedGroups } from './sync';

/**
 * The live friend map: where the people in your groups are, and each group's meet-up pin.
 * There is no push server, so everything comes from asking. The tracker's once-a-second
 * loop calls liveTick() while you record (the only loop there is), and the map asks once
 * when it opens. A pin someone else set is announced with a local notification, once.
 */

export interface LivePin extends Pin {
  groupId: string;
  groupName: string;
}

export interface LiveState {
  friends: LiveMember[];
  pins: LivePin[];
}

/** How often to ask while recording. In your pocket the radio wakes less often, to save battery. */
const EVERY_MS = 20_000;
const EVERY_BACKGROUND_MS = 60_000;
const SEEN_KEY = 'live:seenPins';

let state: LiveState = { friends: [], pins: [] };
const listeners = new Set<() => void>();

export function useLive(): LiveState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

let lastAt = 0;
let running: Promise<void> | null = null;

/** Called every second by the tracker while recording; asks the server only every 20 s (60 s in the background). */
export function liveTick(pos: LatLon | null) {
  const every = AppState.currentState === 'background' ? EVERY_BACKGROUND_MS : EVERY_MS;
  if (!friendsEnabled() || Date.now() - lastAt < every) return;
  refreshLive(pos).catch(() => undefined);
}

/**
 * Sends where you are (when given, and sharing is on) and fetches your friends and the pins.
 * Calls made while one is running share it. Fails without signal: what was known stays on the map.
 */
export function refreshLive(pos: LatLon | null = null): Promise<void> {
  if (!friendsEnabled()) return Promise.resolve();
  running ??= doRefresh(pos).finally(() => { running = null; });
  return running;
}

async function doRefresh(pos: LatLon | null) {
  lastAt = Date.now();
  if (pos && getSettings().shareLive) await api.postLive(pos.lat, pos.lon).catch(() => undefined);
  const friends = new Map<string, LiveMember>(); // someone in two of your groups is still one person
  const pins: LivePin[] = [];
  // ponytail: one request per group per tick. Fine for a few groups; make it one combined endpoint if people sit in many.
  for (const g of await cachedGroups()) {
    const live = await api.groupLive(g.id).catch((e) => {
      if (e instanceof FriendsError && e.status === 404) return null; // you left the group, or the server is an older one
      throw e;
    });
    if (!live) continue;
    for (const m of live.members) friends.set(m.playerId, m);
    if (live.pin) pins.push({ ...live.pin, groupId: g.id, groupName: g.name });
  }
  state = { friends: [...friends.values()], pins };
  listeners.forEach((l) => l());
  await announce(pins);
}

/** Per group, the `createdAt` of the last pin you were told about. Kept across restarts. */
let seen: Record<string, number> | null = null;

async function announce(pins: LivePin[]) {
  if (!seen) {
    try {
      seen = JSON.parse((await kvGet(SEEN_KEY)) ?? '{}') ?? {};
    } catch {
      seen = {};
    }
  }
  const told = seen!;
  const fresh = unseenPins(pins, told);
  if (!fresh.length) return;
  // Remembered before anything is shown: a pin is announced once, whatever happens next.
  for (const p of fresh) told[p.groupId] = p.createdAt;
  await kvSet(SEEN_KEY, JSON.stringify(told));
  for (const p of fresh) {
    await Notifications.scheduleNotificationAsync({
      identifier: `meet-pin-${p.groupId}`, // a changed pin takes the place of the old notification
      content: { title: `${p.createdByName} set a meet-up`, body: `${pinText(p)} · ${p.groupName}` },
      trigger: null,
    }).catch(() => undefined);
  }
}

/**
 * Asks for notification access when you start a day, if you are in a group: a pin should
 * reach you with the phone in your pocket. The system remembers the answer and asks once.
 */
export async function allowPinNotifications(): Promise<void> {
  if (!friendsEnabled() || !(await cachedGroups()).length) return;
  const p = await Notifications.getPermissionsAsync();
  if (!p.granted && p.canAskAgain) await Notifications.requestPermissionsAsync();
}

/** You stopped recording (or turned sharing off): take your position off your friends' maps. */
export async function leaveLive(): Promise<void> {
  if (!friendsEnabled()) return;
  await running?.catch(() => undefined); // an upload still on its way must not land after this
  await api.stopLive().catch(() => undefined);
}
