import { buildBackup, packPoints, parseBackup, unpackPoints } from '../src/lib/backup';
import { compareDays, sameArea } from '../src/lib/compare';
import { offset } from '../src/lib/geo';
import { fileNameFor, toGpx, xmlEscape } from '../src/lib/gpx';
import { bboxOf, matchRunsToPistes, overpassQuery, parseOverpass } from '../src/lib/pistes';
import { simulateDay, SIM_ORIGIN } from '../src/lib/sim';
import { cleanTrack, computeStats } from '../src/lib/stats';

const day = simulateDay({ barometer: true });

describe('GPX export', () => {
  const gpx = toGpx('Zoë’s day <Ischgl & co>', day.points.slice(0, 3));
  it('writes valid-looking GPX with escaped names', () => {
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<name>Zoë’s day &lt;Ischgl &amp; co&gt;</name>');
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    expect(gpx).toMatch(/<ele>\d+\.\d<\/ele><time>2026-01-17T08:45:00\.000Z<\/time>/);
    expect(gpx).toContain('<gpxtpx:speed>');
  });
  it('escapes all XML specials', () => {
    expect(xmlEscape(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
  it('makes safe file names', () => {
    expect(fileNameFor(new Date(2026, 0, 17).getTime(), 'Ischgl, Tirol / Österreich', 'gpx')).toBe('ski-2026-01-17-ischgl-tirol-osterreich.gpx');
    expect(fileNameFor(new Date(2026, 0, 17).getTime(), null, 'png')).toBe('ski-2026-01-17.png');
  });
});

describe('backup', () => {
  it('round-trips days, challenges and attempts', () => {
    const b = buildBackup(
      [{ id: 'd1', startedAt: 1, endedAt: 2, place: 'Lech', isDemo: false, points: packPoints(day.points.slice(0, 50)) }],
      [{ id: 's1', name: 'Wall', createdAt: 5, creatorName: 'Me', path: [[47, 10, 2000], [47.01, 10, 1900]], gateRadius: 30 }],
      [{ id: 'p:1', segmentId: 's1', sessionId: 'd1', playerId: 'p', playerName: 'Me', time: 80.5, at: 1000, ghost: [0, 1, 2] }],
    );
    const back = parseBackup(JSON.stringify(b));
    expect(back.days[0].place).toBe('Lech');
    expect(unpackPoints(back.days[0].points)).toEqual(day.points.slice(0, 50).map((p) => ({ ...p, pres: p.pres ?? null })));
    expect(back.segments[0].name).toBe('Wall');
    expect(back.attempts[0].time).toBe(80.5);
  });

  it('rejects other files and skips broken entries', () => {
    expect(() => parseBackup('not json')).toThrow(/isn’t a Ski Tracker backup/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/isn’t a Ski Tracker backup/);
    expect(() => parseBackup('{"app":"ski-tracker","v":99}')).toThrow(/newer version/);
    const b = parseBackup(JSON.stringify({ app: 'ski-tracker', v: 1, days: [{ id: '../x', startedAt: 1 }, { id: 'ok', startedAt: 1, points: [[1, 200, 0], 'x', [2, 47, 10, null]] }] }));
    expect(b.days.map((d) => d.id)).toEqual(['ok']);
    expect(unpackPoints(b.days[0].points)).toHaveLength(1);
  });
});

describe('piste names', () => {
  const pts = cleanTrack(day.points);
  const stats = computeStats(day.points);
  const runs = stats.activities.filter((a) => a.kind === 'run');
  const run = runs[0];
  // A fake OSM piste exactly along the simulated run, and a decoy 300 m east.
  const along = pts.slice(run.startIndex, run.endIndex + 1).filter((_, i) => i % 10 === 0).map((p) => ({ lat: p.lat, lon: p.lon }));
  const decoy = along.map((p) => offset(p, 90, 300));
  const overpass = {
    elements: [
      { type: 'way', id: 1, tags: { 'piste:type': 'downhill', 'piste:difficulty': 'advanced' }, geometry: along.slice(0, 40) },
      { type: 'relation', id: 9, tags: { 'piste:type': 'downhill', name: 'Hahnenkamm', 'piste:difficulty': 'advanced' },
        members: [{ type: 'way', geometry: along }] },
      { type: 'way', id: 2, tags: { 'piste:type': 'downhill', name: 'Decoy', 'piste:difficulty': 'easy' }, geometry: decoy },
      { type: 'node', id: 3 },
    ],
  };

  it('builds a bounded Overpass query', () => {
    const q = overpassQuery(bboxOf(pts));
    expect(q).toContain('"piste:type"="downhill"');
    expect(q).toMatch(/\(47\.00\d+,10\.28\d+,47\.03\d+,10\.30\d+\)/);
  });

  it('parses ways and relations', () => {
    const pistes = parseOverpass(overpass);
    expect(pistes.map((p) => p.name)).toEqual([null, 'Hahnenkamm', 'Decoy']);
    expect(parseOverpass({})).toEqual([]);
  });

  it('names every run after the piste it followed', () => {
    const matches = matchRunsToPistes(pts, runs, parseOverpass(overpass));
    expect(Object.keys(matches)).toHaveLength(4); // all 4 runs are on the same piste
    expect(matches[String(run.startTime)]).toMatchObject({ name: 'Hahnenkamm', difficulty: 'advanced' });
    expect(matches[String(run.startTime)].coverage).toBeGreaterThan(0.8);
  });

  it('leaves runs unnamed when no piste is close', () => {
    const far = parseOverpass({ elements: [{ type: 'way', id: 2, tags: { name: 'Decoy' }, geometry: decoy }] });
    expect(matchRunsToPistes(pts, runs, far)).toEqual({});
  });
});

describe('compare days', () => {
  const slow = computeStats(simulateDay({ runTopSpeeds: [12, 13], runs: 2, seed: 2 }).points);
  const fast = computeStats(simulateDay({ runTopSpeeds: [18, 22, 20], runs: 3, seed: 3 }).points);
  it('picks the better day per stat', () => {
    const rows = compareDays(slow, fast);
    const by = Object.fromEntries(rows.map((r) => [r.key, r.winner]));
    expect(by.top).toBe('b');
    expect(by.runs).toBe('b');
    expect(by.fastestRun).toBe('b');
    expect(compareDays(fast, fast).every((r) => r.winner === 'tie')).toBe(true);
  });
  it('knows when two days were on the same mountain', () => {
    const other = simulateDay({ seed: 9 }).points;
    expect(sameArea(day.points, other)).toBe(true);
    const elsewhere = other.map((p) => ({ ...p, lat: p.lat + 1 }));
    expect(sameArea(day.points, elsewhere)).toBe(false);
    expect(SIM_ORIGIN.lat).toBeGreaterThan(46);
  });
});
