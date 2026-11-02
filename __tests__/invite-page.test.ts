/**
 * The invite web page (docs/c/invite.js) has its own plain-JS copy of the decoder
 * so it needs no build step. These tests make sure it stays in sync with the app.
 */
import { attemptId, buildSegmentPath, findAttempts, leaderboard, type Attempt, type Segment } from '../src/lib/segments';
import { decodeChallenge, encodeChallenge, extractCode } from '../src/lib/share';
import { simulateDay } from '../src/lib/sim';
import { cleanTrack, computeStats } from '../src/lib/stats';
import { INVITE_PAGE_URL } from '../src/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const page = require('../docs/c/invite.js') as {
  decodeChallenge: (code: string) => {
    segment: { id: string; name: string; creatorName: string | null; path: [number, number, number | null][] };
    leaderboard: { playerId: string; playerName: string; time: number; at: number }[];
    fromName: string | null;
  };
  fmtRaceTime: (s: number) => string;
  lengthOf: (path: [number, number, number | null][]) => number;
  codeFromLocation: (loc: { hash?: string; search?: string }) => string | null;
};

const sim = simulateDay();
const pts = cleanTrack(sim.points);
const run = computeStats(sim.points).activities.find((a) => a.kind === 'run')!;
const segment: Segment = {
  id: 's-abc', name: 'Zoë’s “Wall” ⛷️', createdAt: Date.UTC(2026, 0, 1), creatorName: 'Zoë',
  path: buildSegmentPath(pts, run.startIndex, run.endIndex), gateRadius: 30,
};
const attempts: Attempt[] = [
  ...findAttempts(sim.points, segment).map((r) => ({
    id: attemptId('p-zoe', r.startT), segmentId: segment.id, sessionId: 'x', playerId: 'p-zoe', playerName: 'Zoë',
    time: r.time, at: r.startT, ghost: r.ghost,
  })),
  { id: 'p-sam:1', segmentId: segment.id, sessionId: null, playerId: 'p-sam', playerName: '<b>Sam</b>', time: 999.9, at: 1000, ghost: null },
];
const code = encodeChallenge(segment, attempts, 'Zoë');

describe('invite web page', () => {
  it('decodes exactly what the app encodes', () => {
    const web = page.decodeChallenge(code);
    const app = decodeChallenge(code);
    expect(web.segment.name).toBe(app.segment.name);
    expect(web.segment.path).toEqual(app.segment.path);
    expect(web.fromName).toBe('Zoë');
    expect(web.leaderboard.map((e) => [e.playerId, e.playerName, e.time])).toEqual(
      leaderboard(app.attempts).map((e) => [e.playerId, e.playerName, e.time]),
    );
  });

  it('formats times and lengths like the app', () => {
    expect(page.fmtRaceTime(48.24)).toBe('48.2s');
    expect(page.fmtRaceTime(83.36)).toBe('1:23.4');
    expect(page.lengthOf(segment.path)).toBeGreaterThan(2000);
  });

  it('rejects broken codes with the same message', () => {
    expect(() => page.decodeChallenge('hello')).toThrow(/broken/);
    expect(() => page.decodeChallenge(code.slice(0, 200))).toThrow(/broken/);
  });

  it('reads the code from the link the app shares, and the app can paste it back', () => {
    const link = `${INVITE_PAGE_URL}#d=${code}`;
    const url = new URL(link);
    expect(url.host).toBe('rhsts.github.io');
    expect(page.codeFromLocation({ hash: url.hash, search: url.search })).toBe(code);
    expect(page.codeFromLocation({ hash: `#d=${code}&noapp=1` })).toBe(code);
    expect(extractCode(`Beat me! ${link}`)).toBe(code);
  });
});
