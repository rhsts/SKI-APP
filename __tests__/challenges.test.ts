import { offset } from '../src/lib/geo';
import {
  attemptId, buildSegmentPath, findAttempts, ghostTimeAt, leaderboard, pathInfo, pickTarget, Racer,
  GHOST_SAMPLES, type Attempt, type Segment,
} from '../src/lib/segments';
import { decodeChallenge, decodeInts, encodeChallenge, encodeInts, extractCode, fromBase64Url, toBase64Url } from '../src/lib/share';
import { simulateDay } from '../src/lib/sim';
import { cleanTrack, computeStats } from '../src/lib/stats';

/** A challenge made from the first run of a simulated day (all runs use the same piste). */
function makeSegment(trim = 0) {
  const sim = simulateDay();
  const pts = cleanTrack(sim.points);
  const stats = computeStats(sim.points);
  const run = stats.activities.find((a) => a.kind === 'run')!;
  const from = run.startIndex + trim, to = run.endIndex - trim;
  const segment: Segment = {
    id: 'seg-1', name: 'Black Diamond Dash', createdAt: Date.UTC(2026, 0, 17), creatorName: 'Alex',
    path: buildSegmentPath(pts, from, to), gateRadius: 30,
  };
  return { sim, segment, run, pts, from, to };
}

describe('segment timing', () => {
  const { sim, segment, pts, from, to } = makeSegment();

  it('builds a compact course line', () => {
    expect(segment.path.length).toBeGreaterThan(5);
    expect(segment.path.length).toBeLessThanOrEqual(150);
    const info = pathInfo(segment.path);
    expect(info.length).toBeGreaterThan(2000);
    expect(info.drop).toBeGreaterThan(550);
  });

  it('times every pass through the segment, and each run is faster', () => {
    const attempts = findAttempts(sim.points, segment);
    expect(attempts).toHaveLength(4);
    for (let i = 1; i < attempts.length; i++) expect(attempts[i].time).toBeLessThan(attempts[i - 1].time);
  });

  it('measures close to the real time between the gates', () => {
    const [first] = findAttempts(sim.points, segment);
    const raw = (pts[to].t - pts[from].t) / 1000;
    // Timing runs between the 30 m gate circles, so it's shorter than the whole run
    // (most of the difference is the slow push-off at the top and the slow-down at the bottom).
    expect(first.time).toBeLessThan(raw);
    expect(first.time).toBeGreaterThan(raw - 30);
  });

  it('records a monotonic ghost', () => {
    const [a] = findAttempts(sim.points, segment);
    expect(a.ghost).toHaveLength(GHOST_SAMPLES + 1);
    expect(a.ghost[0]).toBe(0);
    expect(a.ghost[GHOST_SAMPLES]).toBeCloseTo(a.time, 1);
    for (let k = 1; k < a.ghost.length; k++) expect(a.ghost[k]).toBeGreaterThanOrEqual(a.ghost[k - 1]);
    expect(ghostTimeAt(a.ghost, 0.5)).toBeGreaterThan(0);
    expect(ghostTimeAt(a.ghost, 0.5)).toBeLessThan(a.time);
  });

  it('matches a different day on the same piste (a friend’s phone)', () => {
    const other = simulateDay({ seed: 7, runs: 2, runTopSpeeds: [22, 24], start: Date.UTC(2026, 1, 3, 9) });
    const attempts = findAttempts(other.points, segment);
    expect(attempts).toHaveLength(2);
  });

  it('does not count a run that leaves the course', () => {
    // Shift the middle of every run 200 m sideways: start and finish gates still hit, course isn't followed.
    const shifted = sim.points.map((p, i) => {
      const n = sim.points.length;
      if (i % 1000 < 400 || i / n < 0.02) return p;
      const q = offset(p, 90, 200);
      return { ...p, lat: q.lat, lon: q.lon };
    });
    const real = findAttempts(sim.points, segment).length;
    expect(findAttempts(shifted, segment).length).toBeLessThan(real);
  });

  it('does not finish a segment by taking a shortcut straight to the finish', () => {
    const racer = new Racer(segment);
    const start = { lat: segment.path[0][0], lon: segment.path[0][1] };
    const finish = { lat: segment.path.at(-1)![0], lon: segment.path.at(-1)![1] };
    const steps = 400; // one fix per second, ~5 m/s
    const pts = Array.from({ length: steps + 1 }, (_, i) => ({
      lat: start.lat + ((finish.lat - start.lat) * i) / steps,
      lon: start.lon + ((finish.lon - start.lon) * i) / steps,
      t: i * 1000, alt: null, acc: 5, spd: null,
    }));
    const events = pts.map((p) => racer.push(p)).filter(Boolean);
    expect(events.some((e) => e!.type === 'start')).toBe(true);
    expect(events.some((e) => e!.type === 'finish')).toBe(false);
  });
});

describe('leaderboard', () => {
  const a = (player: string, time: number, at: number): Attempt => ({
    id: attemptId(player, at), segmentId: 's', sessionId: null, playerId: player, playerName: player.toUpperCase(),
    time, at, ghost: Array.from({ length: GHOST_SAMPLES + 1 }, (_, k) => (k / GHOST_SAMPLES) * time),
  });
  const attempts = [a('me', 80, 1), a('me', 75, 2), a('alex', 78, 3), a('sam', 90, 4), a('alex', 79, 5)];

  it('keeps each player’s best and ranks them', () => {
    const board = leaderboard(attempts);
    expect(board.map((e) => [e.playerId, e.time, e.rank, e.attempts])).toEqual([
      ['me', 75, 1, 2], ['alex', 78, 2, 2], ['sam', 90, 3, 1],
    ]);
  });

  it('races the leader, or your own PB when you lead', () => {
    expect(pickTarget(attempts, 'me')).toMatchObject({ name: 'ME', mine: true, time: 75 });
    expect(pickTarget([...attempts, a('alex', 70, 6)], 'me')).toMatchObject({ name: 'ALEX', mine: false, time: 70 });
  });
});

describe('challenge links', () => {
  const { sim, segment } = makeSegment();
  const mine: Attempt[] = findAttempts(sim.points, segment).map((r) => ({
    id: attemptId('player-me', r.startT), segmentId: segment.id, sessionId: 'x', playerId: 'player-me',
    playerName: 'Zoë ⛷️', time: r.time, at: r.startT, ghost: r.ghost,
  }));

  it('encodes numbers and unicode text losslessly', () => {
    const nums = [0, 1, -1, 4705312, -1029, 2420, 2419, 0];
    expect(decodeInts(encodeInts(nums))).toEqual(nums);
    const text = 'Zoë ⛷️ “Piste 7” 😀';
    expect(fromBase64Url(toBase64Url(text))).toBe(text);
  });

  it('round-trips a challenge', () => {
    const code = encodeChallenge(segment, mine, 'Zoë ⛷️');
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(5000);
    const back = decodeChallenge(code);
    expect(back.fromName).toBe('Zoë ⛷️');
    expect(back.segment.name).toBe(segment.name);
    expect(back.segment.path).toHaveLength(segment.path.length);
    back.segment.path.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(segment.path[i][0], 4);
      expect(p[1]).toBeCloseTo(segment.path[i][1], 4);
      expect(p[2]).toBe(segment.path[i][2]);
    });
    // Only the best attempt per player travels, with the same id it has locally.
    const best = leaderboard(mine)[0];
    expect(back.attempts).toHaveLength(1);
    expect(back.attempts[0]).toMatchObject({ id: best.id, playerName: 'Zoë ⛷️', time: best.time });
    expect(back.attempts[0].ghost).toHaveLength(GHOST_SAMPLES + 1);
  });

  it('a received course still times runs', () => {
    const back = decodeChallenge(encodeChallenge(segment, mine, null));
    expect(findAttempts(sim.points, back.segment)).toHaveLength(4);
  });

  it('rejects broken or tampered codes with a friendly message', () => {
    expect(() => decodeChallenge('hello')).toThrow(/broken/);
    expect(() => decodeChallenge(toBase64Url(JSON.stringify({ v: 1, id: 'x', p: '' })))).toThrow(/broken/);
    expect(() => decodeChallenge(toBase64Url(JSON.stringify({ v: 99 })))).toThrow(/newer version/);
    const evil = toBase64Url(JSON.stringify({ v: 1, id: '../../x', p: encodeInts([1, 2]) + ',' + encodeInts([1, 2]), l: [] }));
    expect(() => decodeChallenge(evil)).toThrow(/broken/);
  });

  it('finds the code in a link or a pasted message', () => {
    const code = encodeChallenge(segment, mine, 'Zoë');
    expect(extractCode(`Beat my time! skiapp://c?d=${code}`)).toBe(code);
    expect(extractCode(`exp://192.168.1.4:8081/--/c?d=${code}&x=1`)).toBe(code);
    expect(extractCode(`  ${code}  `)).toBe(code);
    expect(extractCode('nothing here')).toBeNull();
  });
});

describe('the full friend loop', () => {
  const { sim, segment } = makeSegment();
  const asAttempts = (player: string, name: string, results: ReturnType<typeof findAttempts>, sessionId: string): Attempt[] =>
    results.map((r) => ({ id: attemptId(player, r.startT), segmentId: segment.id, sessionId, playerId: player, playerName: name, time: r.time, at: r.startT, ghost: r.ghost }));
  const merge = (local: Attempt[], incoming: Attempt[]) => {
    const byId = new Map(local.map((a) => [a.id, a]));
    for (const a of incoming) if (!byId.has(a.id)) byId.set(a.id, a);
    return [...byId.values()];
  };

  it('Alex challenges Sam, Sam beats it and sends the time back', () => {
    // Alex records the challenge (4 runs, last one fastest).
    const alex = asAttempts('alex', 'Alex', findAttempts(sim.points, segment), 'a-day');
    const invite = decodeChallenge(encodeChallenge(segment, alex, 'Alex'));
    expect(invite.attempts).toHaveLength(1); // only Alex's best travels

    // Sam skis the same piste faster on another day.
    const samDay = simulateDay({ seed: 3, runs: 2, runTopSpeeds: [23, 26], start: Date.UTC(2026, 1, 8, 9) });
    const sam = asAttempts('sam', 'Sam', findAttempts(samDay.points, invite.segment), 's-day');
    const samBoard = leaderboard(merge(invite.attempts, sam));
    expect(samBoard[0].playerId).toBe('sam');

    // Sam replies; Alex imports it twice (no duplicates) and sees Sam in the lead.
    const reply = decodeChallenge(encodeChallenge(invite.segment, merge(invite.attempts, sam), 'Sam'));
    let alexLocal = merge(alex, reply.attempts);
    alexLocal = merge(alexLocal, reply.attempts);
    expect(alexLocal.filter((a) => a.playerId === 'alex')).toHaveLength(4);
    const board = leaderboard(alexLocal);
    expect(board.map((e) => e.playerId)).toEqual(['sam', 'alex']);
    expect(board[1].attempts).toBe(4);
  });

  it('a live racer shows you ahead of a slower ghost', () => {
    const results = findAttempts(sim.points, segment);
    const slowGhost = results[0].ghost; // first (slowest) run
    const racer = new Racer(segment);
    const deltas: number[] = [];
    let finished = 0;
    for (const p of cleanTrack(sim.points)) {
      const ev = racer.push(p);
      if (ev?.type === 'finish') finished++;
      if (finished === 3 && racer.status === 'racing' && racer.progress > 0.5) {
        deltas.push(racer.elapsed - ghostTimeAt(slowGhost, racer.progress));
      }
    }
    expect(deltas.length).toBeGreaterThan(10);
    expect(deltas[deltas.length - 1]).toBeLessThan(-5); // the 4th run is much faster than the 1st
  });
});
