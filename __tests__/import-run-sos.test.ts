import { emergencyNumbers, formatCoords } from '../src/lib/emergency';
import { parseGpx, splitDays, toGpx } from '../src/lib/gpx';
import { runDetail } from '../src/lib/rundetail';
import { simulateDay } from '../src/lib/sim';
import { cleanTrack, computeStats, smoothedAltitudes, smoothedSpeeds } from '../src/lib/stats';

describe('GPX import', () => {
  const day = simulateDay({ runs: 2 });
  it('reads back what we export, including speed and elevation', () => {
    const back = parseGpx(toGpx('x', day.points));
    expect(back).toHaveLength(day.points.length);
    expect(back[10].lat).toBeCloseTo(day.points[10].lat, 6);
    expect(back[10].alt).toBeCloseTo(day.points[10].alt as number, 0);
    expect(back[10].spd).toBeCloseTo(day.points[10].spd as number, 1);
    expect(computeStats(back).runCount).toBe(2);
  });

  it('handles other apps’ GPX: single quotes, namespaces, no speed, self-closing points without time', () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lon='10.1' lat='47.2'><ele>2000</ele><time>2026-01-17T09:00:00Z</time></trkpt>
      <trkpt lat="47.201" lon="10.1"><ele>1990.5</ele><time>2026-01-17T09:00:05Z</time><extensions><ns3:speed>4.2</ns3:speed></extensions></trkpt>
      <trkpt lat="47.3" lon="10.2"/>
      <trkpt lat="bad" lon="10"><time>2026-01-17T09:00:09Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const pts = parseGpx(xml);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lat: 47.2, lon: 10.1, alt: 2000, spd: null });
    expect(pts[1].spd).toBe(4.2);
    expect(pts[1].t - pts[0].t).toBe(5000);
  });

  it('splits a multi-day file at overnight gaps', () => {
    const d1 = simulateDay({ runs: 1, start: Date.UTC(2026, 0, 10, 9) }).points;
    const d2 = simulateDay({ runs: 1, start: Date.UTC(2026, 0, 11, 9) }).points;
    const days = splitDays([...d1, ...d2]);
    expect(days.map((d) => d.length)).toEqual([d1.length, d2.length]);
  });
});

describe('run detail', () => {
  const day = simulateDay({ runs: 1 });
  const pts = cleanTrack(day.points);
  const stats = computeStats(day.points);
  const run = stats.activities.find((a) => a.kind === 'run')!;
  const d = runDetail(pts, smoothedAltitudes(pts), smoothedSpeeds(pts), run);
  it('measures steepness sensibly for a ~610 m drop over ~2.5 km', () => {
    expect(d.avgSlopeDeg).toBeGreaterThan(12);
    expect(d.avgSlopeDeg).toBeLessThan(16);
    expect(d.maxSlopeDeg).toBeGreaterThan(d.avgSlopeDeg);
    expect(d.maxSlopeDeg).toBeLessThan(40);
    expect(d.steepestAt).toBeGreaterThanOrEqual(run.startIndex);
  });
  it('finds the fastest moment inside the run', () => {
    expect(d.topSpeedAt).toBeGreaterThanOrEqual(run.startIndex);
    expect(d.topSpeedAt).toBeLessThanOrEqual(run.endIndex);
  });
});

describe('emergency info', () => {
  it('formats coordinates for rescue services', () => {
    const c = formatCoords(47.0137, -10.2918);
    expect(c.decimal).toBe('47.01370° N, 10.29180° W');
    expect(c.dms).toBe(`47°0'49.3"N 10°17'30.5"W`);
    expect(c.mapsLink).toBe('https://maps.google.com/?q=47.013700,-10.291800');
  });
  it('puts the local emergency number first', () => {
    expect(emergencyNumbers('en-US')[0]).toBe('911');
    expect(emergencyNumbers('de-AT')[0]).toBe('112');
    expect(emergencyNumbers('fr')[0]).toBe('112');
  });
});
