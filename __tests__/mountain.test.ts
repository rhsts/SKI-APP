import { liftLabel, matchLiftRides, matchRunsToPistes, overpassQuery, parseLifts } from '../src/lib/pistes';
import { simulateDay, SIM_ORIGIN } from '../src/lib/sim';
import { cleanTrack, computeStats } from '../src/lib/stats';
import { bboxAround, buildTrailMap, covers, mapFor, nearestFeature } from '../src/lib/trailmap';
import { fmtSnow, fmtTemp, fmtWind, parseWeather, weatherInfo, weatherUrl } from '../src/lib/weather';
import { localProjector } from '../src/lib/geo';

const day = simulateDay();
const pts = cleanTrack(day.points);
const stats = computeStats(day.points);
const { fromXY } = localProjector(SIM_ORIGIN);
// The simulator's chairlift runs from the origin to (0, 1900) m.
const liftLine = [fromXY(0, 0), fromXY(0, 950), fromXY(0, 1900)];
const overpass = {
  elements: [
    { type: 'way', id: 7, tags: { aerialway: 'chair_lift', name: 'Gampen' }, geometry: liftLine },
    { type: 'way', id: 8, tags: { aerialway: 'gondola' }, geometry: [fromXY(3000, 0), fromXY(3000, 2000)] },
    { type: 'way', id: 9, tags: { aerialway: 'pylon' }, geometry: liftLine },
    { type: 'way', id: 1, tags: { 'piste:type': 'downhill', name: 'Hahnenkamm', 'piste:difficulty': 'intermediate' }, geometry: liftLine },
  ],
};

describe('lift names', () => {
  it('asks Overpass for lifts too', () => {
    expect(overpassQuery([47, 10, 47.1, 10.1])).toContain('way["aerialway"~"^(chair_lift|gondola');
  });

  it('parses lifts and ignores pylons', () => {
    const lifts = parseLifts(overpass);
    expect(lifts.map((l) => [l.name, l.type])).toEqual([['Gampen', 'chair_lift'], [null, 'gondola']]);
    expect(liftLabel('t-bar')).toBe('T-bar');
  });

  it('names every lift ride after the lift it took', () => {
    const rides = stats.activities.filter((a) => a.kind === 'lift');
    const m = matchLiftRides(pts, rides, parseLifts(overpass));
    expect(Object.keys(m)).toHaveLength(rides.length);
    expect(m[String(rides[0].startTime)].name).toBe('Gampen · Chairlift');
  });

  it('leaves rides unnamed when no lift is close', () => {
    const rides = stats.activities.filter((a) => a.kind === 'lift');
    const far = parseLifts({ elements: [overpass.elements[1]] });
    expect(matchLiftRides(pts, rides, far)).toEqual({});
  });
});

describe('offline trail map', () => {
  const bbox = bboxAround(SIM_ORIGIN.lat, SIM_ORIGIN.lon, 6);
  const map = buildTrailMap(overpass, bbox, 'm1', 1000);
  it('keeps pistes and lifts, thinned', () => {
    expect(map.pistes).toHaveLength(1);
    expect(map.lifts).toHaveLength(2);
    expect(map.lifts[0].coords.length).toBe(2); // straight line → just its ends
  });
  it('knows which area it covers', () => {
    expect(covers(map, SIM_ORIGIN)).toBe(true);
    expect(covers(map, { lat: SIM_ORIGIN.lat + 0.2, lon: SIM_ORIGIN.lon })).toBe(false);
    const newer = { ...map, id: 'm2', fetchedAt: 2000 };
    expect(mapFor([map, newer], SIM_ORIGIN)?.id).toBe('m2');
    expect(mapFor([map], { lat: 0, lon: 0 })).toBeNull();
  });
  it('finds the nearest named piste or lift (for rescuers)', () => {
    const near = nearestFeature(map, fromXY(40, 900)); // 40 m east of the chairlift / piste line, mid-way
    expect(near?.name === 'Gampen' || near?.name === 'Hahnenkamm').toBe(true);
    expect(near!.meters).toBeLessThan(60);
    expect(nearestFeature(map, fromXY(1500, 900))).toBeNull();
  });
});

describe('snow and weather', () => {
  it('asks for weather at your altitude', () => {
    const u = weatherUrl(47.01, 10.29, 2412.4);
    expect(u).toContain('latitude=47.0100');
    expect(u).toContain('elevation=2412');
    expect(u).toContain('snowfall');
  });

  it('reads current conditions, fresh snow and the outlook', () => {
    // Local time UTC+1. "Now" is 2026-01-17 10:30 local = 09:30 UTC.
    const now = Date.UTC(2026, 0, 17, 9, 30);
    const hours: string[] = [];
    const snowfall: number[] = [];
    const depth: number[] = [];
    for (let h = 0; h < 72; h++) {
      const t = new Date(Date.UTC(2026, 0, 16, h));
      hours.push(t.toISOString().slice(0, 16));
      snowfall.push(h >= 20 && h < 30 ? 1.5 : 0); // 15 cm overnight (local hours 20:00 → 06:00)
      depth.push(0.8 + (h >= 30 ? 0.15 : 0));
    }
    const w = parseWeather({
      utc_offset_seconds: 3600,
      current: { temperature_2m: -6.4, apparent_temperature: -12.1, wind_speed_10m: 22, wind_gusts_10m: 41, weather_code: 73 },
      hourly: { time: hours, snowfall, snow_depth: depth },
      daily: {
        time: ['2026-01-16', '2026-01-17', '2026-01-18', '2026-01-19'],
        weather_code: [73, 3, 0, 71], temperature_2m_max: [-2, -4, -1, 0], temperature_2m_min: [-9, -10, -8, -5],
        snowfall_sum: [9, 6, 0, 3],
      },
    }, now);
    expect(w.tempC).toBe(-6.4);
    expect(w.freshSnowCm).toBe(15);
    expect(w.snowDepthCm).toBe(95);
    expect(w.days.map((d) => d.date)).toEqual(['2026-01-17', '2026-01-18', '2026-01-19']);
    expect(weatherInfo(w.code).label).toBe('Snow');
  });

  it('copes with an empty response and formats units', () => {
    const w = parseWeather({});
    expect(w.tempC).toBeNull();
    expect(w.days).toEqual([]);
    expect(fmtTemp(-6.4, 'metric')).toBe('-6°C');
    expect(fmtTemp(-10, 'imperial')).toBe('14°F');
    expect(fmtSnow(15, 'metric')).toBe('15 cm');
    expect(fmtSnow(15, 'imperial')).toBe('5.9 in');
    expect(fmtWind(40, 'imperial')).toBe('25 mph');
  });
});

describe('runs over several pistes', () => {
  // A straight 1 km run north→south over three pistes, none of them more than half of it.
  const { fromXY } = localProjector(SIM_ORIGIN);
  const pts = Array.from({ length: 101 }, (_, k) => {
    const p = fromXY(0, 1000 - k * 10);
    return { t: k * 1000, lat: p.lat, lon: p.lon, alt: 2000 - k * 3, acc: 5, spd: 10 };
  });
  const run = { kind: 'run' as const, startIndex: 0, endIndex: 100, startTime: 0, endTime: 100000, duration: 100, distance: 1000, verticalDown: 300, verticalUp: 0, topSpeed: 12, avgSpeed: 10 };
  const line = (x: number, y0: number, y1: number) => [fromXY(x, y0), fromXY(x, y1)];

  it('is on piste when it was on some piste most of the way, named after the main one', () => {
    const pistes = [
      { id: 'a', name: 'Rote', difficulty: 'intermediate' as const, coords: line(0, 1000, 600) },
      { id: 'b', name: 'Blaue', difficulty: 'easy' as const, coords: line(0, 560, 300) },
      { id: 'c', name: 'Talabfahrt', difficulty: 'easy' as const, coords: line(0, 260, 0) },
    ];
    const m = matchRunsToPistes(pts, [run], pistes)['0'];
    expect(m?.name).toBe('Rote');
    expect(m?.coverage).toBeGreaterThan(0.95);
  });

  it('a wide piste: 45 m from the centre line still counts', () => {
    const m = matchRunsToPistes(pts, [run], [{ id: 'w', name: 'Wide', difficulty: 'easy', coords: line(45, 1000, 0) }])['0'];
    expect(m?.name).toBe('Wide');
  });

  it('takes the name from one OSM piece and the difficulty from another', () => {
    const m = matchRunsToPistes(pts, [run], [
      { id: 'r', name: 'Route 7', difficulty: null, coords: line(0, 1000, 0) },
      { id: 'w', name: null, difficulty: 'intermediate', coords: line(10, 1000, 0) },
    ])['0'];
    expect(m).toMatchObject({ name: 'Route 7', difficulty: 'intermediate' });
  });

  it('a piste mapped as an area counts anywhere inside it', () => {
    const box = [fromXY(-150, 1050), fromXY(150, 1050), fromXY(150, -50), fromXY(-150, -50), fromXY(-150, 1050)];
    const m = matchRunsToPistes(pts, [run], [{ id: 'a', name: null, difficulty: 'easy', coords: box, area: true }])['0'];
    expect(m?.difficulty).toBe('easy');
  });

  it('a long wait at the side of the piste does not make the run off piste', () => {
    const side = fromXY(80, 500);
    const wait = Array.from({ length: 300 }, (_, k) => ({ t: 50500 + k * 1000, lat: side.lat, lon: side.lon, alt: 1850, acc: 5, spd: 0 }));
    const later = pts.slice(51).map((p) => ({ ...p, t: p.t + 301000 }));
    const all = [...pts.slice(0, 51), ...wait, ...later];
    const long = { ...run, endIndex: all.length - 1, endTime: all[all.length - 1].t };
    expect(matchRunsToPistes(all, [long], [{ id: 'p', name: 'Main', difficulty: 'easy', coords: line(0, 1000, 0) }])['0']?.name).toBe('Main');
  });

  it('really off piste stays unmatched', () => {
    expect(matchRunsToPistes(pts, [run], [{ id: 'f', name: 'Far', difficulty: 'easy', coords: line(200, 1000, 0) }])).toEqual({});
  });
});
