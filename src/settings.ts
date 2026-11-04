import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, loadSettings, newId, renamePlayer, saveSettings, type Settings } from './db';

let current: Settings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

export async function initSettings() {
  current = await loadSettings();
  if (!current.playerId || !current.deviceSecret) {
    current = {
      ...current,
      playerId: current.playerId || `p-${newId()}`,
      deviceSecret: current.deviceSecret || randomSecret(),
    };
    await saveSettings(current);
  }
  listeners.forEach((l) => l());
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
