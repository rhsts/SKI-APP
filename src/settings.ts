import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, loadSettings, newId, renamePlayer, saveSettings, type Settings } from './db';

let current: Settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

export async function initSettings() {
  current = await loadSettings();
  if (!current.playerId || !current.deviceSecret || !current.deviceId) {
    const playerId = current.playerId || `p-${newId()}`;
    current = {
      ...current,
      playerId,
      // Phones set up before accounts existed are known to the server by their player id.
      deviceId: current.deviceId || playerId,
      deviceSecret: current.deviceSecret || randomSecret(),
    };
    await saveSettings(current);
  }
  listeners.forEach((l) => l());
}

/** A fresh identity for this phone (after logging out): new device id, secret and player id. */
export function newIdentity(): Pick<Settings, 'playerId' | 'deviceId' | 'deviceSecret'> {
  const id = `p-${newId()}`;
  return { playerId: id, deviceId: id, deviceSecret: randomSecret() };
}

/** 32 random characters for the friends server login. */
function randomSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(Crypto.getRandomBytes(32), (b) => chars[b % chars.length]).join('');
}

/** Current settings outside React (tracker, challenge service). */
export function getSettings(): Settings {
  return current;
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => current,
  );
}

export async function updateSettings(patch: Partial<Settings>) {
  const renamed = patch.name != null && patch.name !== current.name;
  current = { ...current, ...patch };
  listeners.forEach((l) => l());
  await saveSettings(current);
  if (renamed) await renamePlayer(current.playerId, displayName(current));
}

/** Name shown on leaderboards. */
export function displayName(s: Settings = current): string {
  return s.name.trim() || 'Me';
}
