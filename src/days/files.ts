import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { matchSession } from '../challenges/service';
import {
  getPoints, getSession, insertPoints, insertSessionRaw, listAttempts, listSegments, listSessions, saveSegment,
  upsertAttempts,
} from '../db';
import { buildBackup, packPoints, parseBackup, unpackPoints } from '../lib/backup';
import { fileNameFor, toGpx } from '../lib/gpx';
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
