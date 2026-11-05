import { strToU8, zipSync } from 'fflate';
import { isZip, parseSlopes } from '../src/lib/slopes';
import { simulateDay } from '../src/lib/sim';
import { cleanTrack, computeStats, despikeAltitude } from '../src/lib/stats';
import type { TrackPoint } from '../src/lib/types';

/** A .slopes file (ZIP) built from a simulated day, the way Slopes writes it. */
function slopesFile(points: TrackPoint[], opts: { raw?: boolean; offset?: number; overrides?: string; place?: string } = {}) {
  const csv = points
    .map((p) => [(p.t / 1000).toFixed(6), p.lat.toFixed(6), p.lon.toFixed(6), ((p.alt ?? 0) + (opts.raw ? opts.offset ?? 0 : 0)).toFixed(6), '-1.0', (p.spd ?? 0).toFixed(6), (p.acc ?? 5).toFixed(1), '3.8'].join(','))
    .join('\n');
  const meta = `<?xml version="1.0"?><Activity locationName="${opts.place ?? 'Gr&amp;nd Valley'}" altitudeOffset="${opts.offset ?? 0}"` +
    `${opts.overrides ? ` overrides="${opts.overrides}"` : ''} vertical="2440" topSpeed="20.5" distance="12000"><actions>` +
    '<Action type="Lift" /><Action type="Run" /><Action type="Run" /></actions></Activity>';
  return zipSync({ [opts.raw ? 'RawGPS.csv' : 'GPS.csv']: strToU8(csv), 'Metadata.xml': strToU8(meta) });
}

describe('.slopes import', () => {
  const day = simulateDay({ start: Date.UTC(2026, 1, 18, 8, 30) });

  it('reads the track, place and Slopes totals', () => {
    const bytes = slopesFile(day.points);
    expect(isZip(bytes)).toBe(true);
    const d = parseSlopes(bytes);
    expect(d.place).toBe('Gr&nd Valley');
    expect(d.points).toHaveLength(day.points.length);
    expect(d.points[0].t).toBe(day.points[0].t);
    expect(d.slopes).toEqual({ vertical: 2440, topSpeed: 20.5, distance: 12000, runs: 2, lifts: 1 });
    const st = computeStats(d.points);
    expect(st.runCount).toBe(4);
    expect(st.verticalDown).toBeGreaterThan(2200);
  });

  it('uses RawGPS.csv with the altitude offset when there is no GPS.csv', () => {
    const d = parseSlopes(slopesFile(day.points, { raw: true, offset: 53.4 }));
    expect(d.points[100].alt).toBeCloseTo(day.points[100].alt!, 3);
  });

  it('leaves out time you told Slopes to ignore', () => {
    const a = Math.round(day.points[500].t / 1000), b = Math.round(day.points[900].t / 1000);
    const d = parseSlopes(slopesFile(day.points, { overrides: `${a}-${b}:ignore` }));
    expect(d.points.length).toBe(day.points.length - 401);
  });

  it('drops the fake 80 m/s fixes Slopes fills glitches with', () => {
    const pts = day.points.map((p, i) => (i >= 300 && i < 304 ? { ...p, spd: 80 } : p));
    const d = parseSlopes(slopesFile(pts));
    expect(d.points.slice(300, 304).every((p) => p.spd == null)).toBe(true);
    expect(computeStats(d.points).topSpeed).toBeLessThan(25);
  });

  it('refuses files that aren’t .slopes', () => {
    expect(isZip(new Uint8Array([60, 63, 120, 109, 108]))).toBe(false);
    expect(() => parseSlopes(new Uint8Array([80, 75, 3, 4, 0, 0]))).toThrow();
    expect(() => parseSlopes(zipSync({ 'Metadata.xml': strToU8('<Activity/>') }))).toThrow('no GPS track');
  });
});

describe('GPS altitude glitches', () => {
  it('ignores an altitude jump of 1,200 m in a few seconds', () => {
    const base = simulateDay({ start: Date.UTC(2026, 1, 18, 8, 30) }).points;
    const glitched = base.map((p, i) => (i >= 400 && i < 410 ? { ...p, alt: 1482 } : p));
    const clean = despikeAltitude(cleanTrack(glitched));
    expect(clean.slice(400, 410).every((p) => p.alt == null)).toBe(true);
    const good = computeStats(base).verticalDown, bad = computeStats(glitched).verticalDown;
    expect(Math.abs(bad - good)).toBeLessThan(60);
  });

  it('accepts a new altitude level that holds (a bad first fix)', () => {
    const pts: TrackPoint[] = [{ t: 0, lat: 47, lon: 10, alt: 5000, acc: 5, spd: 0 }];
    for (let k = 1; k <= 120; k++) pts.push({ t: k * 1000, lat: 47, lon: 10 + k * 1e-6, alt: 2000, acc: 5, spd: 0 });
    const out = despikeAltitude(pts);
    expect(out[out.length - 1].alt).toBe(2000);
  });
});
