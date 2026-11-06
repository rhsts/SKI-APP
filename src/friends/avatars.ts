import { useEffect, useSyncExternalStore } from 'react';
import { kvGet } from '../db';
import { getSettings } from '../settings';
import { api, friendsEnabled } from './api';

/**
 * Profile pictures, fetched once per app start and kept in memory.
 * `undefined` = not fetched yet, `null` = no picture.
 */

const cache = new Map<string, string | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

export function setMyAvatar(playerId: string, jpeg: string | null) {
  cache.set(playerId, jpeg);
  changed();
}

export function forgetAvatar(playerId: string) {
  cache.delete(playerId);
  changed();
}

async function load(playerId: string) {
  if (loading.has(playerId) || cache.has(playerId)) return;
  loading.add(playerId);
  try {
    if (playerId === getSettings().playerId) {
      const mine = await kvGet('avatar:me');
      if (mine) {
        cache.set(playerId, mine);
        return;
      }
    }
    if (!friendsEnabled()) return;
    cache.set(playerId, (await api.playerAvatar(playerId)).jpeg);
  } catch {
    // No signal: try again next time it's shown.
  } finally {
    loading.delete(playerId);
    changed();
  }
}

/** The picture of a skier as a data URI, or null. Pass `hasAvatar: false` to skip asking the server. */
export function useAvatar(playerId: string | null | undefined, hasAvatar = true): string | null {
  useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => version,
  );
  useEffect(() => {
    if (playerId && (hasAvatar || playerId === getSettings().playerId)) load(playerId);
  }, [playerId, hasAvatar]);
  const jpeg = playerId ? cache.get(playerId) : null;
  return jpeg ? `data:image/jpeg;base64,${jpeg}` : null;
}
