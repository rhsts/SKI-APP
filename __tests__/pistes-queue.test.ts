/**
 * Background piste lookup from the Season tab: stale finished days get looked up
 * one at a time, each at most once per app run.
 */
import type { SessionRow } from '../src/db';
import { simulateDay } from '../src/lib/sim';
import { lookupStalePistes, PISTES_VERSION, VERSION_KEY } from '../src/mountain/pistes';

const mockPoints = simulateDay().points;
const mockSessions: Record<string, Partial<SessionRow>> = {};
jest.mock('../src/db', () => ({
  getSession: jest.fn(async (id: string) => mockSessions[id] ?? null),
  getPoints: jest.fn(async () => mockPoints),
  setSessionPistes: jest.fn(async () => undefined),
  saveTrailMap: jest.fn(async () => undefined),
  newId: () => 'x',
}));

const day = (id: string, o: Partial<SessionRow> = {}): SessionRow => {
  const d = { id, startedAt: 1, endedAt: 2, place: null, stats: null, isDemo: false, pistes: null, sport: 'ski', ...o } as SessionRow;
  mockSessions[id] = d;
  return d;
};
const fresh = { [VERSION_KEY]: { name: null, difficulty: null, coverage: PISTES_VERSION } };
const stale = { [VERSION_KEY]: { name: null, difficulty: null, coverage: PISTES_VERSION - 1 } };

it('looks up stale days one at a time, skips the rest, survives failures, never twice', async () => {
  let open = 0;
  let maxOpen = 0;
  let calls = 0;
  globalThis.fetch = jest.fn(async () => {
    calls++;
    open++;
    maxOpen = Math.max(maxOpen, open);
    await new Promise((r) => setTimeout(r, 5));
    open--;
    return calls === 1 ? { ok: false } : { ok: true, json: async () => ({ elements: [] }) };
  }) as unknown as typeof fetch;

  const days = [
    day('a', { pistes: stale }), // fails (first fetch)
    day('b'), // never looked up
    day('c', { pistes: fresh }), // up to date
    day('d', { isDemo: true }), // demo
    day('e', { endedAt: null }), // still recording
    day('f', { pistes: stale }),
  ];
  const found: string[] = [];
  await lookupStalePistes(days, (id) => found.push(id));
  expect(calls).toBe(3);
  expect(maxOpen).toBe(1);
  expect(found).toEqual(['b', 'f']);

  await lookupStalePistes(days, (id) => found.push(id)); // second visit to the tab, same app run
  expect(calls).toBe(3);
});
