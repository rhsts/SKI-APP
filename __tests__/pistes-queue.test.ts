/**
 * App-wide piste lookup queue: stale finished days get looked up one at a time,
 * newest first; a failed day is tried again on the next call.
 */
import type { SessionRow } from '../src/db';
import { simulateDay } from '../src/lib/sim';
import { lookupPistes, lookupStalePistes, onPistesFound, prefetchTrailMap, PREFETCH_EVERY_MS, OVERPASS_RETRY, PISTES_VERSION, VERSION_KEY } from '../src/mountain/pistes';

OVERPASS_RETRY.waitsMs = [0, 1, 1]; // no real waiting in tests

const mockPoints = simulateDay().points;
const mockSessions: Record<string, Partial<SessionRow>> = {};
const mockMaps: unknown[] = [];
jest.mock('../src/db', () => ({
  getSession: jest.fn(async (id: string) => mockSessions[id] ?? null),
  getPoints: jest.fn(async () => mockPoints),
  setSessionPistes: jest.fn(async () => undefined),
  saveTrailMap: jest.fn(async (m: unknown) => { mockMaps.push(m); }),
  listTrailMaps: jest.fn(async () => mockMaps),
  newId: () => 'x',
}));

const day = (id: string, o: Partial<SessionRow> = {}): SessionRow => {
  const d = { id, startedAt: 1, endedAt: 2, place: null, stats: null, isDemo: false, pistes: null, sport: 'ski', ...o } as SessionRow;
  mockSessions[id] = d;
  return d;
};
// Every test starts with no saved maps (they'd otherwise answer the next test's lookups).
beforeEach(() => { mockMaps.length = 0; });
const fresh = { [VERSION_KEY]: { name: null, difficulty: null, coverage: PISTES_VERSION } };
const stale = { [VERSION_KEY]: { name: null, difficulty: null, coverage: PISTES_VERSION - 1 } };

it('looks up stale days one at a time, newest first, skips the rest, retries only failures', async () => {
  let open = 0;
  let maxOpen = 0;
  let calls = 0;
  globalThis.fetch = jest.fn(async () => {
    calls++;
    open++;
    maxOpen = Math.max(maxOpen, open);
    await new Promise((r) => setTimeout(r, 5));
    open--;
    // Day a: every server fails.
    return calls <= OVERPASS_RETRY.waitsMs.length ? { ok: false } : { ok: true, json: async () => ({ elements: [] }) };
  }) as unknown as typeof fetch;

  const days = [
    day('f', { pistes: stale, startedAt: 1 }),
    day('b', { startedAt: 2 }), // never looked up
    day('c', { pistes: fresh }), // up to date
    day('d', { isDemo: true }), // demo
    day('e', { endedAt: null }), // still recording
    day('a', { pistes: stale, startedAt: 3 }), // newest; fails every try
  ];
  const found: string[] = [];
  const stop = onPistesFound((id) => found.push(id));
  await lookupStalePistes(days);
  // a: every try fails; b: one fetch; f: same track as b, so it reuses b's saved map.
  expect(calls).toBe(OVERPASS_RETRY.waitsMs.length + 1);
  expect(maxOpen).toBe(1);
  expect(found).toEqual(['b', 'f']);

  // Next call (back in the app, Season tab): only the failed day a is tried again,
  // and it now finds b's saved map, so no new fetch.
  await lookupStalePistes(days);
  expect(calls).toBe(OVERPASS_RETRY.waitsMs.length + 1);
  expect(found).toEqual(['b', 'f', 'a']);
  stop();
});

it('limit caps how many days one call takes on', async () => {
  globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ elements: [] }) })) as unknown as typeof fetch;
  const found: string[] = [];
  const stop = onPistesFound((id) => found.push(id));
  await lookupStalePistes([day('k', { startedAt: 5 }), day('l', { startedAt: 6 })], 1);
  expect(found).toEqual(['l']);
  stop();
});

it('a half-finished answer (busy server) is not saved; it asks again', async () => {
  day('g');
  let calls = 0;
  globalThis.fetch = jest.fn(async () => {
    calls++;
    return calls === 1
      ? { ok: true, json: async () => ({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 41 seconds.' }) }
      : { ok: true, json: async () => ({ elements: [] }) };
  }) as unknown as typeof fetch;
  const p = await lookupPistes('g');
  expect(calls).toBe(2);
  expect(p?.[VERSION_KEY]?.coverage).toBe(PISTES_VERSION);
});

it('the day screen and the Season tab asking at once share one lookup', async () => {
  day('h');
  let calls = 0;
  globalThis.fetch = jest.fn(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, json: async () => ({ elements: [] }) };
  }) as unknown as typeof fetch;
  const [a, b] = await Promise.all([lookupPistes('h'), lookupPistes('h')]);
  expect(calls).toBe(1);
  expect(a).toBe(b);
});

it('another day at the same resort reuses the saved map instead of asking the server', async () => {
  day('i');
  day('j');
  let calls = 0;
  globalThis.fetch = jest.fn(async () => {
    calls++;
    return { ok: true, json: async () => ({ elements: [] }) };
  }) as unknown as typeof fetch;
  mockMaps.length = 0;
  await lookupPistes('i');
  const p = await lookupPistes('j'); // same track, so inside the saved area
  expect(calls).toBe(1);
  expect(p?.[VERSION_KEY]?.coverage).toBe(PISTES_VERSION);
  // A map saved before maps were known to be complete isn't trusted.
  mockMaps.length = 0;
  mockMaps.push({ id: 'old', bbox: [-90, -180, 90, 180], fetchedAt: 0, pistes: [], lifts: [] });
  await lookupPistes('j');
  expect(calls).toBe(2);
});

it('while recording, fetches the resort map once and then only rechecks every 10 minutes', async () => {
  let calls = 0;
  globalThis.fetch = jest.fn(async () => {
    calls++;
    return { ok: true, json: async () => ({ elements: [] }) };
  }) as unknown as typeof fetch;
  const { lat, lon } = mockPoints[0];
  const t0 = 1e12;
  await prefetchTrailMap(lat, lon, t0);
  expect(calls).toBe(1);
  await prefetchTrailMap(lat, lon, t0 + 60000); // too soon: not even checked
  await prefetchTrailMap(lat, lon, t0 + PREFETCH_EVERY_MS); // saved map covers here: no fetch
  expect(calls).toBe(1);
  await prefetchTrailMap(lat + 0.5, lon, t0 + 2 * PREFETCH_EVERY_MS); // another resort
  expect(calls).toBe(2);
  // At the end of the day, the lookup uses the map saved during the day.
  day('m');
  const p = await lookupPistes('m');
  expect(calls).toBe(2);
  expect(p?.[VERSION_KEY]?.coverage).toBe(PISTES_VERSION);
});
