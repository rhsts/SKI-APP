import { areaAt, skiAreas } from '../src/lib/areas';
import { parseExifDate, placePhoto, positionAt } from '../src/lib/photos';
import { simulateDay } from '../src/lib/sim';

const start = new Date(2026, 0, 17, 9, 0, 0).getTime(); // local time, like camera EXIF
const pts = simulateDay({ start, runs: 1 }).points;

describe('photos on the map', () => {
  it('reads camera dates as local time', () => {
    expect(parseExifDate('2026:01:17 10:12:33')).toBe(new Date(2026, 0, 17, 10, 12, 33).getTime());
    expect(parseExifDate('garbage')).toBeNull();
  });

  it('uses the photo’s own GPS tag (with N/S/E/W refs)', () => {
    const p = placePhoto({ GPSLatitude: [47, 1, 2.5], GPSLatitudeRef: 'N', GPSLongitude: 10.5, GPSLongitudeRef: 'W', DateTimeOriginal: '2026:01:17 09:05:00' }, pts);
    expect(p).toMatchObject({ source: 'gps', lon: -10.5 });
    expect(p!.lat).toBeCloseTo(47 + 1 / 60 + 2.5 / 3600, 6);
  });

  it('places a photo without GPS by its time on your track', () => {
    const t = pts[300].t;
    const d = new Date(t);
    const exifTime = `${d.getFullYear()}:${String(d.getMonth() + 1).padStart(2, '0')}:${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const p = placePhoto({ DateTimeOriginal: exifTime }, pts);
    expect(p).toMatchObject({ source: 'time', t });
    expect(p!.lat).toBeCloseTo(pts[300].lat, 6);
  });

  it('rejects photos from another day, and interpolates between fixes', () => {
    expect(placePhoto({ DateTimeOriginal: '2025:12:01 10:00:00' }, pts)).toBeNull();
    expect(placePhoto({}, pts)).toBeNull();
    const mid = positionAt(pts, (pts[10].t + pts[11].t) / 2)!;
    expect(mid.lat).toBeCloseTo((pts[10].lat + pts[11].lat) / 2, 9);
    expect(positionAt(pts, pts[0].t - 3600 * 1000)).toBeNull();
  });
});

describe('ski areas you have visited', () => {
  const areas = skiAreas([
    { place: 'Ischgl, Tyrol', lat: 47.01, lon: 10.29 },
    { place: 'Ischgl, Tyrol', lat: 47.015, lon: 10.3 },
    { place: null, lat: 47.2, lon: 11.4 },
    { place: 'Galtür', lat: 46.97, lon: 10.19 },
  ]);
  it('merges nearby days and names areas', () => {
    expect(areas.map((a) => [a.name, a.days])).toEqual([['Ischgl', 2], ['Ski area', 1], ['Galtür', 1]]);
  });
  it('knows when you are back at one', () => {
    expect(areaAt(areas, { lat: 47.012, lon: 10.295 })?.name).toBe('Ischgl');
    expect(areaAt(areas, { lat: 48, lon: 11 })).toBeNull();
  });
});
