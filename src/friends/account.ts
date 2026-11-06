import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { matchSession } from '../challenges/service';
import {
  getPoints, insertMotionEvents, insertPoints, insertSessionRaw, kvGet, kvSet, listAttempts, listMotionEvents,
  listSessions, reassignPlayer,
} from '../db';
import { computeBadges } from '../lib/goals';
import { isSport } from '../lib/sport';
import { computeStats } from '../lib/stats';
import { packDay, unpackDay } from '../lib/trackpack';
import { getSettings, newIdentity, updateSettings } from '../settings';
import { api, type MeInfo } from './api';
import { resetFriendsCache, syncFriends } from './sync';
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

/** Logs out: the phone gets a fresh identity. Days stay on the phone. */
export async function logOut(): Promise<void> {
  await api.logout().catch(() => undefined);
  await resetFriendsCache();
  await kvSet('avatar:me', null);
  forgetAvatar(getSettings().playerId);
  await updateSettings({ ...newIdentity(), account: null });
}

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

/** Uploads days that changed since their last backup. Returns how many were uploaded. */
export async function backupDays(): Promise<number> {
  const s = getSettings();
  if (!s.account || !s.backupDays) return 0;
  let n = 0;
  for (const day of await listSessions()) {
    if (day.isDemo) continue;
    const points = await getPoints(day.id);
    if (points.length < 2) continue;
    const sig = `${points.length}:${day.endedAt}:${day.place}:${day.sport}`;
    const key = `backup:${day.id}`;
    if ((await kvGet(key)) === sig) continue;
    const motion = await listMotionEvents(day.id);
    const data = packDay({ startedAt: day.startedAt, endedAt: day.endedAt, place: day.place, sport: day.sport, isDemo: false, points, motion });
    await api.putTrack(day.id, { startedAt: day.startedAt, endedAt: day.endedAt, place: day.place, sport: day.sport, data });
    await kvSet(key, sig);
    n++;
  }
  return n;
}

/** Backed-up days that aren't on this phone. */
export async function missingBackups() {
  if (!getSettings().account) return [];
  const local = await listSessions();
  const ids = new Set(local.map((d) => d.id));
  const starts = local.map((d) => d.startedAt);
  return (await api.tracks()).filter((t) => !ids.has(t.dayId) && !starts.some((s) => Math.abs(s - t.startedAt) < 60000));
}

/** Downloads backed-up days that aren't on this phone. Returns how many were added. */
export async function restoreDays(): Promise<number> {
  let added = 0;
  for (const t of await missingBackups()) {
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
    .map((b) => ({ id: b.id, emoji: b.emoji, title: b.title, at: b.earnedAt }));
  const sig = badges.map((b) => b.id).join(',');
  if ((await kvGet('profile:badges')) === sig) return;
  await api.setProfile(badges);
  await kvSet('profile:badges', sig);
}
