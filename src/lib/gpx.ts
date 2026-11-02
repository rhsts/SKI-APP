import type { TrackPoint } from './types';

/** XML-escapes text for element content and attributes. */
export function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/**
 * A day as GPX 1.1, readable by Strava, Komoot, Google Earth, etc.
 * Speed goes into the Garmin-style extension most apps understand.
 */
export function toGpx(name: string, points: TrackPoint[]): string {
  const pts = points
    .map((p) => {
      const ele = p.alt != null && Number.isFinite(p.alt) ? `<ele>${p.alt.toFixed(1)}</ele>` : '';
      const time = `<time>${new Date(p.t).toISOString()}</time>`;
      const spd = p.spd != null && Number.isFinite(p.spd)
        ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${p.spd.toFixed(2)}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>`
        : '';
      return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${ele}${time}${spd}</trkpt>`;
    })
    .join('\n');
  const n = xmlEscape(name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ski Tracker" xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${n}</name>${points.length ? `<time>${new Date(points[0].t).toISOString()}</time>` : ''}</metadata>
  <trk>
    <name>${n}</name>
    <type>alpine_ski</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** A safe file name like "ski-2026-01-17-ischgl.gpx". */
export function fileNameFor(startedAt: number, place: string | null, ext: string): string {
  const d = new Date(startedAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const slug = (place ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `ski-${date}${slug ? `-${slug}` : ''}.${ext}`;
}
