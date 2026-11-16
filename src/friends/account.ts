import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { dialog } from '../dialog';
import { matchSession } from '../challenges/service';
import {
  countPoints, deleteSession, getPoints, insertMotionEvents, insertPoints, insertSessionRaw, kvGet, kvSet, listAttempts, listMotionEvents,
  listSessions, reassignPlayer,
} from '../db';
import { computeBadges } from '../lib/goals';
import { isSport } from '../lib/sport';
import { computeStats } from '../lib/stats';
import { packDay, unpackDay } from '../lib/trackpack';
import { getSettings, newIdentity, updateSettings } from '../settings';
import { api, FriendsError, setLoggedOutHandler, type MeInfo } from './api';
import { flushPendingDeletes, pendingDeletes, resetFriendsCache, syncFriends } from './sync';
import { forgetAvatar, setMyAvatar } from './avatars';

/**
 * Your account on the friends server: log in on any phone, your days backed
 * up online, a profile picture and badges your friends can see.
 */

function saveAccount(me: MeInfo) {
  return updateSettings({
    account: me.username ? { username: me.username, isAdmin: me.isAdmin } : null,
    name: me.name && me.name !== 'Skier' ? me.name : getSettings().name,
  });
}

export async function createAccount(username: string, password: string, name: string): Promise<void> {
  if (name.trim()) await updateSettings({ name: name.trim() });
  const me = await api.register(username.trim(), password, name.trim() || getSettings().name);
  await saveAccount(me);
  syncFriends().catch(() => undefined);
}

/** Logs this phone in to an existing account. Returns how many backed-up days aren't on this phone yet. */
export async function logIn(username: string, password: string): Promise<number> {
  const before = getSettings().playerId;
  const me = await api.login(username.trim(), password);
  if (me.id !== before) {
    // From now on this phone is that skier: earlier challenge times on this phone move along.
    await reassignPlayer(before, me.id, me.name);
    await updateSettings({ playerId: me.id });
    await resetFriendsCache();
  }
  await saveAccount(me);
  await syncFriends().catch(() => undefined);
  return (await missingBackups().catch(() => [])).length;
}

const CANT_LOG_OUT = 'Can’t log out: your days couldn’t be saved to your account. Connect to the internet and try again.';

/**
 * Logs out: your days are saved to your account, then removed from this phone, and the
 * phone gets a fresh identity (so the next skier doesn't get your days).
 * Days too big to back up block it unless `force`: then it returns how many, changing nothing.
 */
export async function logOut(force = false): Promise<{ unsaved: number }> {
  if (!getSettings().account) throw new Error('You’re not logged in.');
  // The day being recorded isn't finished, so it can't be backed up yet.
  if (await kvGet('active')) throw new Error('Stop recording before you log out.');
  const r = await backupDays({ all: true }).catch(() => null);
  if (!r || r.failed || (await flushPendingDeletes().catch(() => 1))) throw new Error(CANT_LOG_OUT);
  if (r.tooBig && !force) return { unsaved: r.tooBig };
  await api.logout().catch(() => undefined);
  for (const d of await listSessions()) await deleteSession(d.id);
  await forgetAccount();
  return { unsaved: 0 };
}

/** The phone gets a fresh identity and no account. */
async function forgetAccount() {
  await resetFriendsCache();
  await kvSet('avatar:me', null);
  forgetAvatar(getSettings().playerId);
  await updateSettings({ ...newIdentity(), account: null });
}

/**
 * The server logged this phone out (password changed on another phone). The days are
 * this account's own, so they stay; logging in again picks up where it left off.
 */
export async function loggedOutElsewhere(message: string): Promise<void> {
  if (!getSettings().account) return;
  await forgetAccount();
  dialog('Logged out', message);
}
setLoggedOutHandler(loggedOutElsewhere);

export async function changePassword(old: string, password: string): Promise<void> {
  await api.changePassword(old, password);
}

/** Pick a picture, crop it square, shrink it and make it your profile picture. */
export async function pickAvatar(): Promise<boolean> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo access is needed to pick a profile picture.');
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (res.canceled || !res.assets?.length) return false;
  const ref = await ImageManipulator.manipulate(res.assets[0].uri).resize({ width: 256, height: 256 }).renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  if (!out.base64) throw new Error('Couldn’t read that picture.');
  await api.setAvatar(out.base64);
  await kvSet('avatar:me', out.base64);
  setMyAvatar(getSettings().playerId, out.base64);
  return true;
}

export async function removeAvatar(): Promise<void> {
  await api.deleteAvatar();
  await kvSet('avatar:me', null);
  setMyAvatar(getSettings().playerId, null);
}

// ---------- online backup ----------

/** The server takes backups up to this many base64 characters (server/src/app.js MAX_TRACK). */
const MAX_TRACK = 6 * 1000 * 1000;

export interface BackupResult { uploaded: number; failed: number; tooBig: number }

/**
 * Uploads days that changed since their last backup. One day failing doesn't stop the others.
 * `failed`: couldn't be sent (no signal, server trouble), tried again next time.
 * `tooBig`: the server won't take them; remembered so they aren't packed again every sync.
 * `all`: also when online backup is switched off (logging out).
 */
export async function backupDays({ all = false } = {}): Promise<BackupResult> {
  const s = getSettings();
  const r: BackupResult = { uploaded: 0, failed: 0, tooBig: 0 };
  if (!s.account || !(s.backupDays || all)) return r;
  for (const day of await listSessions()) {
    if (day.isDemo) continue;
    try {
      // Only the count: loading every day's whole track on every sync is slow.
      const n = await countPoints(day.id);
      if (n < 2) continue;
      const sig = `${n}:${day.endedAt}:${day.place}:${day.sport}`;
      const key = `backup:${day.id}`;
      if ((await kvGet(key)) === sig) continue;
      // Not tried again until the day changes (e.g. trimmed).
      const bigKey = `backup-too-big:${day.id}`;
      if ((await kvGet(bigKey)) === sig) {
        r.tooBig++;
        continue;
      }
      const points = await getPoints(day.id);
      const motion = await listMotionEvents(day.id);
      const data = packDay({ startedAt: day.startedAt, endedAt: day.endedAt, place: day.place, sport: day.sport, isDemo: false, points, motion });
      try {
        if (data.length > MAX_TRACK) throw new FriendsError('Too big', 400);
        await api.putTrack(day.id, { startedAt: day.startedAt, endedAt: day.endedAt, place: day.place, sport: day.sport, data });
      } catch (e) {
        if (!(e instanceof FriendsError && e.status === 400)) throw e;
        await kvSet(bigKey, sig);
        r.tooBig++;
        continue;
      }
      await kvSet(key, sig);
      r.uploaded++;
    } catch (e) {
      r.failed++;
      // Server unreachable: the other days won't get through either.
      if (e instanceof FriendsError && e.status === null) break;
    }
  }
  return r;
}

/** Backed-up days that aren't on this phone. */
export async function missingBackups() {
  if (!getSettings().account) return [];
  const local = await listSessions();
  const ids = new Set(local.map((d) => d.id));
  const starts = local.map((d) => d.startedAt);
  // Deleted here, but the server doesn't know yet.
  const deleted = new Set(await pendingDeletes());
  return (await api.tracks()).filter((t) => !ids.has(t.dayId) && !deleted.has(t.dayId) && !starts.some((s) => Math.abs(s - t.startedAt) < 60000));
}

/** Downloads backed-up days that aren't on this phone. Returns how many were added. */
export async function restoreDays(): Promise<number> {
  let added = 0;
  for (const t of await missingBackups()) {
    // One damaged or unreachable day doesn't stop the others.
    try {
      const full = await api.getTrack(t.dayId);
      const d = unpackDay(full.data);
      if (d.points.length < 2) continue;
      const ok = await insertSessionRaw({
        id: t.dayId, startedAt: d.startedAt, endedAt: d.endedAt, place: d.place, isDemo: false,
        stats: computeStats(d.points), sport: isSport(d.sport) ? d.sport : 'ski',
      });
      if (!ok) continue;
      await insertPoints(t.dayId, d.points);
      await insertMotionEvents(t.dayId, d.motion);
      await matchSession(t.dayId, d.points).catch(() => undefined);
      // Already backed up: no need to upload it again.
      await kvSet(`backup:${t.dayId}`, `${d.points.length}:${d.endedAt}:${d.place}:${d.sport}`);
      added++;
    } catch {
      // Tried again next time: it's still missing.
    }
  }
  return added;
}

/** How many of your days are backed up. */
export async function backupStatus(): Promise<{ backedUp: number; total: number }> {
  const days = (await listSessions()).filter((d) => !d.isDemo);
  let backedUp = 0;
  for (const d of days) if (await kvGet(`backup:${d.id}`)) backedUp++;
  return { backedUp, total: days.length };
}

/** Puts your earned badges on your profile, for friends to see. */
export async function uploadProfile(): Promise<void> {
  if (!getSettings().account) return;
  const days = (await listSessions()).filter((d) => d.stats).map((d) => ({ id: d.id, startedAt: d.startedAt, place: d.place, stats: d.stats! }));
  const badges = computeBadges(days, await listAttempts(), getSettings().playerId)
    .filter((b) => b.earnedAt != null)
    .map((b) => ({ id: b.id, title: b.title, at: b.earnedAt }));
  const sig = badges.map((b) => b.id).join(',');
  if ((await kvGet('profile:badges')) === sig) return;
  await api.setProfile(badges);
  await kvSet('profile:badges', sig);
}
