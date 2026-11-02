import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { deletePhoto, getPoints, insertPhoto, newId, type PhotoRow } from '../db';
import { placePhoto } from '../lib/photos';

const photoDir = () => {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create({ idempotent: true });
  return dir;
};

/**
 * Pick photos from the gallery and pin them to the day: by their own GPS tag,
 * or by the time they were taken matched to your track. Copies are kept in the
 * app so they survive the gallery being cleaned up.
 */
export async function addPhotos(sessionId: string): Promise<{ added: number; skipped: number } | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo access is needed to add photos to your day.');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 30,
    exif: true,
    quality: 0.8,
  });
  if (res.canceled || !res.assets?.length) return null;
  const points = await getPoints(sessionId);
  let added = 0, skipped = 0;
  for (const a of res.assets) {
    const place = placePhoto(a.exif ?? null, points);
    if (!place) {
      skipped++;
      continue;
    }
    const id = newId();
    const ext = (a.fileName?.split('.').pop() ?? 'jpg').toLowerCase().slice(0, 4);
    const dest = new File(photoDir(), `${id}.${ext}`);
    await new File(a.uri).copy(dest);
    await insertPhoto({ id, sessionId, uri: dest.uri, t: place.t, lat: place.lat, lon: place.lon });
    added++;
  }
  return { added, skipped };
}

export async function removePhoto(p: PhotoRow): Promise<void> {
  await deletePhoto(p.id);
  try {
    const f = new File(p.uri);
    if (f.exists) f.delete();
  } catch {
    // The file may already be gone.
  }
}
