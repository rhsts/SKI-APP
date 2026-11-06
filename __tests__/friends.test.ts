/// <reference types="node" />
/**
 * @jest-environment node
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import {
  cleanCode, dayUpload, parseInvite, localDate, normalizeServerUrl, rankBoard, rankChallenge, type BoardRow,
} from '../src/lib/groups';
import { simulateDay } from '../src/lib/sim';
import { packDay, unpackDay, fromBase64, toBase64 } from '../src/lib/trackpack';
import { computeStats } from '../src/lib/stats';

// The app's API client, talking to the real server (server/) with two fake phones.
const mockUpdate = jest.fn(async (patch: object) => { Object.assign(mockSettings, patch); });
const mockSettings = { unlocked: true, serverUrl: '', serverPassword: 'powder-day-42', playerId: 'p-anna', deviceId: 'p-anna', deviceSecret: 'anna-secret-0123456789abcdef', name: 'Anna' };
jest.mock('../src/settings', () => ({
  getSettings: () => mockSettings,
  displayName: () => mockSettings.name,
  updateSettings: (p: object) => mockUpdate(p),
}));
// eslint-disable-next-line import/first
import { api, checkServer, setLoggedOutHandler } from '../src/friends/api';
const mockLoggedOut = jest.fn(async (_msg: string) => undefined);
setLoggedOutHandler(mockLoggedOut);

const row = (name: string, vertical: number, topSpeed: number, runs: number, days = 1): BoardRow => ({
  playerId: name, name, vertical, topSpeed, runs, distance: 0, skiTime: 0, days,
});

describe('group leaderboards', () => {
  it('ranks by the chosen metric, ties share a place, non-skiers last', () => {
    const rows = [row('Ben', 5000, 20, 12), row('Anna', 6000, 18, 12), row('Cas', 0, 0, 0, 0), row('Dirk', 5000, 25, 9)];
    expect(rankBoard(rows, 'vertical').map((r) => [r.name, r.rank])).toEqual([['Anna', 1], ['Ben', 2], ['Dirk', 2], ['Cas', null]]);
    expect(rankBoard(rows, 'topSpeed')[0].name).toBe('Dirk');
    expect(rankBoard(rows, 'runs').map((r) => r.rank)).toEqual([1, 1, 3, null]);
  });

  it('challenge ranking keeps each skier’s best time', () => {
    const r = rankChallenge([
      { id: '1', playerId: 'a', playerName: 'A', time: 61, at: 1, ghost: null },
      { id: '2', playerId: 'a', playerName: 'A', time: 58, at: 2, ghost: null },
      { id: '3', playerId: 'b', playerName: 'B', time: 59, at: 3, ghost: null },
    ]);
    expect(r.map((x) => [x.playerName, x.time, x.rank])).toEqual([['A', 58, 1], ['B', 59, 2]]);
  });

  it('a day shares only totals', () => {
    const sim = simulateDay({ start: new Date(2026, 0, 17, 9).getTime() });
    const up = dayUpload(sim.points[0].t, computeStats(sim.points));
    expect(up.date).toBe('2026-01-17');
    expect(Object.keys(up).sort()).toEqual(['date', 'distance', 'runs', 'skiTime', 'startedAt', 'topSpeed', 'vertical']);
    expect(up.runs).toBe(4);
    expect(localDate(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31');
  });

  it('reads an invite message', () => {
    const msg = [
      'Join my ski group “Ischgl 2026” in Ski Tracker!', '',
      '1. Get the app: https://github.com/rhsts/SKI-APP/releases/latest',
      '2. Copy this whole message, open the app and tap “Paste invite”. Or type:',
      '   Server: https://skipi.tail1a2b.ts.net', '   Password: powder-goggles-42', '   Group code: K7MP2Q',
    ].join('\n');
    expect(parseInvite(msg)).toEqual({ server: 'https://skipi.tail1a2b.ts.net', password: 'powder-goggles-42', code: 'K7MP2Q' });
    expect(parseInvite('server http://192.168.1.20:8787, no password')).toEqual({ server: 'http://192.168.1.20:8787', password: null, code: null });
    expect(parseInvite('hello').server).toBeNull();
  });

  it('base64 round-trips any bytes (backups)', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) % 256);
      expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
    }
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
    expect(() => unpackDay('bm90IGd6aXA=')).toThrow('damaged');
  });

  it('cleans up typed server addresses and codes', () => {
    expect(normalizeServerUrl(' ski.example.com/ ')).toBe('https://ski.example.com');
    expect(normalizeServerUrl('http://192.168.1.20:8787')).toBe('http://192.168.1.20:8787');
    expect(normalizeServerUrl('HTTPS://Ski.Example.com/api/')).toBe('https://ski.example.com/api');
    expect(normalizeServerUrl('not a url')).toBeNull();
    expect(normalizeServerUrl('')).toBeNull();
    expect(cleanCode(' ab c-12 3 ')).toBe('ABC123');
  });
});

/** jest-expo swaps fetch for React Native's mock; talk real HTTP to the local server instead. */
function nodeFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}) {
  return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve, reject) => {
    const req = http.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ ok: (res.statusCode ?? 0) < 400, status: res.statusCode ?? 0, json: async () => JSON.parse(data) }));
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

describe('app ↔ server', () => {
  beforeAll(() => { (globalThis as { fetch: unknown }).fetch = nodeFetch; });
  let server: ChildProcess;
  const port = 18000 + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'index.js'], {
      cwd: path.join(__dirname, '..', 'server'),
      env: { ...process.env, PORT: String(port), DB_FILE: ':memory:', SERVER_PASSWORD: 'powder-day-42' },
      stdio: 'ignore',
    });
    mockSettings.serverUrl = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 30; i++) {
      try {
        await checkServer(mockSettings.serverUrl, 'powder-day-42');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('server did not start');
  });
  afterAll(() => { server?.kill(); });

  const as = (who: 'anna' | 'ben') => {
    mockSettings.playerId = `p-${who}`;
    mockSettings.deviceId = `p-${who}`;
    mockSettings.deviceSecret = `${who}-secret-0123456789abcdef`;
    mockSettings.name = who === 'anna' ? 'Anna' : 'Ben';
  };

  it('creates a group, joins it, fills the board and ranks a group challenge', async () => {
    as('anna');
    await api.hello();
    const g = await api.createGroup('Ischgl 2026');
    as('ben');
    await api.hello();
    await api.joinGroup(g.code.toLowerCase());
    await expect(api.joinGroup('ZZZZZZ')).rejects.toThrow('No group with that code');

    const date = '2026-01-17';
    as('anna');
    await api.putDay('a-day', { date, startedAt: 1, vertical: 5200, topSpeed: 21, runs: 14, distance: 30000, skiTime: 8000 });
    as('ben');
    await api.putDay('b-day', { date, startedAt: 1, vertical: 6100, topSpeed: 19, runs: 16, distance: 31000, skiTime: 8100 });

    const board = await api.board(g.id, date);
    expect(rankBoard(board.rows, 'vertical').map((r) => r.name)).toEqual(['Ben', 'Anna']);
    expect(rankBoard(board.rows, 'topSpeed').map((r) => r.name)).toEqual(['Anna', 'Ben']);

    const seg = { id: 'seg-x', name: 'Black wall', createdAt: 1, creatorName: 'Ben', gateRadius: 30,
      path: [[47.01, 10.29, 2400], [47.0, 10.292, 2000]] as [number, number, number][] };
    const c = await api.addChallenge(g.id, date, seg);
    await api.putAttempt('ben-1', { segmentId: 'seg-x', date, time: 63.4, at: 5, ghost: null });
    as('anna');
    await api.putAttempt('anna-1', { segmentId: 'seg-x', date, time: 61.0, at: 6, ghost: [0, 30, 61] });
    const detail = await api.group(g.id);
    expect(detail.challenges.map((x) => x.segment.name)).toEqual(['Black wall']);
    expect(detail.dates).toEqual([date]);
    const cb = rankChallenge((await api.challengeBoard(g.id, c.id)).rows);
    expect(cb.map((r) => [r.playerName, r.time])).toEqual([['Anna', 61], ['Ben', 63.4]]);
  });

  it('needs the server password', async () => {
    as('anna');
    await expect(checkServer(mockSettings.serverUrl, 'wrong')).rejects.toThrow('Wrong server password');
    await expect(checkServer(mockSettings.serverUrl, '')).rejects.toThrow('needs a password');
  });

  it('locks the app again when the saved password stops working', async () => {
    as('anna');
    mockSettings.unlocked = true;
    const saved = mockSettings.serverPassword;
    mockSettings.serverPassword = 'old-password';
    await expect(api.groups()).rejects.toThrow('Wrong server password');
    expect(mockUpdate).toHaveBeenCalledWith({ unlocked: false });
    expect(mockSettings.unlocked).toBe(false);
    mockSettings.serverPassword = saved;
  });

  it('accounts: create, log in on a second phone, back up a day and get it back', async () => {
    as('anna');
    const me = await api.register('anna', 'snowfall9', 'Anna');
    expect(me.username).toBe('anna');
    const sim = simulateDay({ start: new Date(2026, 0, 18, 9).getTime(), runs: 2 });
    const data = packDay({ startedAt: sim.points[0].t, endedAt: sim.points[sim.points.length - 1].t, place: 'Ischgl', sport: 'ski', isDemo: false, points: sim.points, motion: [] });
    await api.putTrack('anna-day-1', { startedAt: sim.points[0].t, endedAt: null, place: 'Ischgl', sport: 'ski', data });
    // A new phone logs in to the same account and finds the day.
    mockSettings.deviceId = 'p-anna-new-phone';
    mockSettings.deviceSecret = 'anna-new-phone-0123456789abcdef';
    await expect(api.login('anna', 'wrong-password')).rejects.toThrow('Wrong username or password');
    const again = await api.login('anna', 'snowfall9');
    expect(again.id).toBe('p-anna');
    const list = await api.tracks();
    expect(list.map((t) => t.dayId)).toEqual(['anna-day-1']);
    const back = unpackDay((await api.getTrack('anna-day-1')).data);
    expect(back.points).toHaveLength(sim.points.length);
    expect(computeStats(back.points).runCount).toBe(2);
    expect(back.place).toBe('Ischgl');
  });

  it('a stolen player id is refused', async () => {
    mockSettings.playerId = 'p-anna';
    mockSettings.deviceId = 'p-anna';
    mockSettings.deviceSecret = 'not-annas-secret-0123456789';
    await expect(api.groups()).rejects.toThrow('another phone');
  });

  it('a password change on another phone logs this phone out', async () => {
    // The new phone (logged in above) changes the password...
    mockSettings.deviceId = 'p-anna-new-phone';
    mockSettings.deviceSecret = 'anna-new-phone-0123456789abcdef';
    await api.changePassword('snowfall9', 'snowfall10');
    // ...so Anna's first phone is sent to the log in screen.
    mockSettings.deviceId = 'p-anna';
    mockSettings.deviceSecret = 'anna-secret-0123456789abcdef';
    await expect(api.hello()).rejects.toThrow('Log in again');
    expect(mockLoggedOut).toHaveBeenCalledWith('Your password was changed on another phone. Log in again.');
  });
});
