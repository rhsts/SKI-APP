import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { matchSession } from '../challenges/service';
import {
  getPoints, insertMotionEvents, listMotionEvents, getSession, insertPoints, insertSessionRaw, listAttempts, listSegments, listSessions, newId, saveSegment,
  upsertAttempts,
} from '../db';
import { lookupPlace } from '../tracking/place';
import { lookupPistes } from '../mountain/pistes';
import { buildBackup, packPoints, parseBackup, unpackPoints } from '../lib/backup';
import { fileNameFor, parseGpx, splitDays, toGpx } from '../lib/gpx';
import { strFromU8 } from 'fflate';
import { isZip, parseSlopes } from '../lib/slopes';
import type { TrackPoint } from '../lib/types';
import { isSport } from '../lib/sport';
import { computeStats } from '../lib/stats';

/** Writes text to a temp file and opens the share sheet (save to Drive, send, open in another app…). */
async function shareText(name: string, content: string, mimeType: string, dialogTitle: string) {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle });
}

/** Exports a day as a GPX file for Strava, Komoot, Google Earth… */
export async function exportGpx(sessionId: string): Promise<void> {
  const [session, points] = await Promise.all([getSession(sessionId), getPoints(sessionId)]);
  if (!session || !points.length) throw new Error('This day has no GPS points to export.');
  const name = session.place ? `Skiing · ${session.place}` : 'Ski day';
  await shareText(fileNameFor(session.startedAt, session.place, 'gpx'), toGpx(name, points), 'application/gpx+xml', 'Export GPX');
}

/** Everything (days with raw GPS, challenges, times) in one JSON file. */
export async function createBackup(): Promise<{ days: number }> {
  const sessions = await listSessions();
  const days = [];
  for (const s of sessions) {
    days.push({
      id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, place: s.place, isDemo: s.isDemo, sport: s.sport,
      points: packPoints(await getPoints(s.id)),
      motion: (await listMotionEvents(s.id)).map((e) => [e.t, e.kind, e.value, e.lat, e.lon] as [number, 'jump' | 'fall', number, number | null, number | null]),
    });
  }
  const backup = buildBackup(days, await listSegments(), await listAttempts());
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await shareText(`ski-tracker-backup-${stamp}.json`, JSON.stringify(backup), 'application/json', 'Save backup');
  return { days: days.length };
}

/**
 * Picks a backup file and merges it in. Days and challenges you already have are
 * kept as they are, so restoring twice is harmless.
 */
export async function restoreBackup(): Promise<{ days: number; challenges: number } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const text = await new File(res.assets[0].uri).text();
  const backup = parseBackup(text);

  let days = 0;
  for (const d of backup.days) {
    const points = unpackPoints(d.points);
    if (points.length < 2) continue;
    const added = await insertSessionRaw({
      id: d.id, startedAt: d.startedAt, endedAt: d.endedAt, place: d.place, isDemo: d.isDemo, stats: computeStats(points),
      sport: isSport(d.sport) ? d.sport : 'ski',
    });
    if (added) {
      await insertPoints(d.id, points);
      await insertMotionEvents(d.id, (d.motion ?? []).map(([t, kind, value, lat, lon]) => ({ t, kind, value, lat, lon })));
      days++;
    }
  }
  const known = new Set((await listSegments()).map((s) => s.id));
  let challenges = 0;
  for (const s of backup.segments) {
    if (!known.has(s.id)) challenges++;
    await saveSegment(s);
  }
  await upsertAttempts(backup.attempts);
  // Days restored before their challenges existed still get timed.
  for (const d of backup.days) await matchSession(d.id).catch(() => undefined);
  return { days, challenges };
}

/**
 * Imports GPX files from other apps (Ski Tracks, Strava, a watch…). A file with
 * several days is split at overnight gaps; days you already have (same start
 * time) are skipped.
 */
/**
 * Imports ski days from other apps: GPX (Strava, watches, Ski Tracks…) and
 * .slopes files from the Slopes app. Days already in the app are skipped.
 */
export async function importTracks(): Promise<{ added: number; skipped: number; files: number; failed: number } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/gpx+xml', 'application/xml', 'text/xml', 'application/zip', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const existing = (await listSessions()).map((s) => s.startedAt);
  let added = 0, skipped = 0, failed = 0;
  for (const asset of res.assets) {
    // Each file gives one or more days, each with a place name if the file knows it.
    let days: { points: TrackPoint[]; place: string | null }[];
    try {
      const file = new File(asset.uri);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isZip(bytes)) {
        const d = parseSlopes(bytes);
        days = splitDays(d.points).map((points) => ({ points, place: d.place }));
      } else {
        days = splitDays(parseGpx(strFromU8(bytes))).map((points) => ({ points, place: null }));
      }
    } catch {
      failed++;
      continue;
    }
    if (!days.length) {
      failed++;
      continue;
    }
    for (const { points: day, place } of days) {
      if (day.length < 20) continue;
      const startedAt = day[0].t;
      if (existing.some((t) => Math.abs(t - startedAt) < 60000)) {
        skipped++;
        continue;
      }
      const id = newId();
      const stats = computeStats(day);
      await insertSessionRaw({
        id, startedAt, endedAt: day[day.length - 1].t, place: place ?? (await lookupPlace(day)), isDemo: false, stats,
      });
      await insertPoints(id, day);
      existing.push(startedAt);
      await matchSession(id, day).catch(() => undefined);
      lookupPistes(id).catch(() => undefined);
      added++;
    }
  }
  if (!added && !skipped && failed) {
    throw new Error('None of these files could be read. Pick .gpx or .slopes files.');
  }
  return { added, skipped, files: res.assets.length, failed };
}
