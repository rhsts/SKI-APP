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

/**
 * Reads tracks from a GPX file (Strava, Ski Tracks, Garmin, Slopes export…).
 * Plain regex parsing: GPX is simple and React Native has no DOM parser.
 * Only points with a timestamp are kept (times are what make stats possible).
 */
export function parseGpx(xml: string): TrackPoint[] {
  const out: TrackPoint[] = [];
  const pt = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  const attr = (attrs: string, name: string) => {
    const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
    return m ? Number(m[1]) : NaN;
  };
  const tag = (body: string, name: string) => {
    const m = body.match(new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]+?)\\s*</(?:\\w+:)?${name}>`));
    return m ? m[1] : null;
  };
  let m: RegExpExecArray | null;
  while ((m = pt.exec(xml))) {
    const lat = attr(m[2], 'lat'), lon = attr(m[2], 'lon');
    const body = m[4] ?? '';
    const time = tag(body, 'time');
    const t = time ? Date.parse(time) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isFinite(t)) continue;
    // Number(null) is 0, so only convert tags that are actually there.
    const num = (v: string | null) => (v == null ? NaN : Number(v));
    const ele = num(tag(body, 'ele'));
    const spd = num(tag(body, 'speed'));
    out.push({ t, lat, lon, alt: Number.isFinite(ele) ? ele : null, acc: null, spd: Number.isFinite(spd) ? spd : null });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Splits a long recording into separate days wherever there's a gap of 6+ hours. */
export function splitDays(points: TrackPoint[], gapMs = 6 * 3600 * 1000): TrackPoint[][] {
  const days: TrackPoint[][] = [];
  for (const p of points) {
    const cur = days[days.length - 1];
    if (!cur || p.t - cur[cur.length - 1].t >= gapMs) days.push([p]);
    else cur.push(p);
  }
  return days;
}
