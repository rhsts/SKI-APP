import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createApi, listener } from '../src/app.js';
import { openDb } from '../src/db.js';

let base, server;
before(async () => {
  server = createServer(listener(createApi(openDb(':memory:'))));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const player = (id) => ({ auth: `Bearer ${id}:secret-${id}-0123456789abcdef` });
async function call(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { authorization: who.auth } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

const anna = player('p-anna'), ben = player('p-ben'), cas = player('p-cas');
const PATH = [[47.01, 10.29, 2400], [47.005, 10.291, 2200], [47.0, 10.292, 2000]];

test('health needs no login', async () => {
  const r = await call(null, 'GET', '/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('a player id is tied to the first secret it was used with', async () => {
  assert.equal((await call(anna, 'PUT', '/v1/me', { name: 'Anna' })).status, 200);
  const thief = { auth: 'Bearer p-anna:some-other-secret-123456' };
  assert.equal((await call(thief, 'GET', '/v1/groups')).status, 401);
  assert.equal((await call(null, 'GET', '/v1/groups')).status, 401);
});

test('groups, daily leaderboard and group challenges', async () => {
  await call(ben, 'PUT', '/v1/me', { name: 'Ben' });
  await call(cas, 'PUT', '/v1/me', { name: 'Cas' });

  const g = (await call(anna, 'POST', '/v1/groups', { name: 'Ischgl 2026' })).json;
  assert.match(g.code, /^[A-Z2-9]{6}$/);
  assert.equal((await call(ben, 'POST', '/v1/groups/join', { code: g.code.toLowerCase() })).status, 200);
  assert.equal((await call(ben, 'POST', '/v1/groups/join', { code: 'NOPE00' })).status, 404);
  // Not a member: the group is invisible.
  assert.equal((await call(cas, 'GET', `/v1/groups/${g.id}`)).status, 404);

  const day = (vertical, topSpeed, runs, startedAt) => ({ date: '2026-01-17', startedAt, vertical, topSpeed, runs, distance: 20000, skiTime: 7200 });
  await call(anna, 'PUT', '/v1/days/a1', day(4000, 20, 12, 1));
  await call(anna, 'PUT', '/v1/days/a2', day(1000, 25, 3, 2)); // second recording the same day adds up
  await call(ben, 'PUT', '/v1/days/b1', day(6000, 22, 15, 1));
  await call(cas, 'PUT', '/v1/days/c1', day(9000, 30, 30, 1)); // not in the group
  assert.equal((await call(ben, 'PUT', '/v1/days/b2', { ...day(1, 1, 1, 1), topSpeed: 500 })).status, 400);

  const board = (await call(ben, 'GET', `/v1/groups/${g.id}/board?date=2026-01-17`)).json;
  const byName = Object.fromEntries(board.rows.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(byName).sort(), ['Anna', 'Ben']);
  assert.equal(byName.Anna.vertical, 5000);
  assert.equal(byName.Anna.topSpeed, 25);
  assert.equal(byName.Anna.runs, 15);
  assert.equal(byName.Ben.vertical, 6000);

  const detail = (await call(anna, 'GET', `/v1/groups/${g.id}`)).json;
  assert.deepEqual(detail.dates, ['2026-01-17']);
  assert.equal(detail.members.length, 2);

  // Group challenge on the 17th.
  const seg = { id: 'seg-1', name: 'Black wall', path: PATH, gateRadius: 30 };
  const c = (await call(anna, 'POST', `/v1/groups/${g.id}/challenges`, { date: '2026-01-17', segment: seg })).json;
  assert.equal(c.segment.name, 'Black wall');
  assert.equal((await call(ben, 'POST', `/v1/groups/${g.id}/challenges`, { date: '2026-01-17', segment: seg })).status, 409);
  assert.equal((await call(ben, 'POST', `/v1/groups/${g.id}/challenges`, { date: '2026-01-17', segment: { ...seg, id: 'x', path: [[1, 2]] } })).status, 400);

  await call(anna, 'PUT', '/v1/attempts/an-1', { segmentId: 'seg-1', date: '2026-01-17', time: 61.2, at: 10, ghost: [0, 1, 2] });
  await call(anna, 'PUT', '/v1/attempts/an-2', { segmentId: 'seg-1', date: '2026-01-17', time: 58.9, at: 20 });
  await call(ben, 'PUT', '/v1/attempts/be-1', { segmentId: 'seg-1', date: '2026-01-17', time: 60.0, at: 15 });
  await call(ben, 'PUT', '/v1/attempts/be-2', { segmentId: 'seg-1', date: '2026-01-18', time: 40.0, at: 99 }); // wrong day
  await call(cas, 'PUT', '/v1/attempts/ca-1', { segmentId: 'seg-1', date: '2026-01-17', time: 30.0, at: 1 }); // not a member
  // Can't overwrite someone else's attempt.
  assert.equal((await call(ben, 'PUT', '/v1/attempts/an-1', { segmentId: 'seg-1', date: '2026-01-17', time: 1, at: 1 })).status, 403);

  const cb = (await call(ben, 'GET', `/v1/groups/${g.id}/challenges/${c.id}/board`)).json;
  assert.deepEqual(cb.rows.map((r) => [r.playerName, r.time]), [['Anna', 58.9], ['Ben', 60]]);

  // Only the creator or owner removes a challenge; leaving the last member deletes the group.
  assert.equal((await call(ben, 'DELETE', `/v1/groups/${g.id}/challenges/${c.id}`)).status, 403);
  assert.equal((await call(anna, 'DELETE', `/v1/groups/${g.id}/challenges/${c.id}`)).status, 200);
  await call(ben, 'DELETE', `/v1/groups/${g.id}/members/me`);
  await call(anna, 'DELETE', `/v1/groups/${g.id}/members/me`);
  assert.equal((await call(anna, 'POST', '/v1/groups/join', { code: g.code })).status, 404);
});

test('a server password keeps strangers out', async () => {
  const locked = createServer(listener(createApi(openDb(':memory:'), { password: 'powder-day-42' })));
  await new Promise((r) => locked.listen(0, r));
  const url = `http://127.0.0.1:${locked.address().port}`;
  const req = (pw) => fetch(`${url}/v1/groups`, {
    headers: { authorization: anna.auth, ...(pw != null ? { 'x-server-password': pw } : {}) },
  });
  try {
    const health = await (await fetch(`${url}/v1/health`)).json();
    assert.equal(health.password, true);
    const t0 = Date.now();
    const wrong = await req('guess');
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).code, 'password');
    assert.ok(Date.now() - t0 >= 900, 'wrong passwords are answered slowly');
    assert.equal((await req(null)).status, 401);
    assert.equal((await req('powder-day-42')).status, 200);
    // Without a password set, the header isn't needed.
    assert.equal((await (await fetch(`${base}/v1/health`)).json()).password, false);
  } finally {
    locked.close();
  }
});

test('too many wrong server passwords lock that IP (and everyone, past a global cap)', () => {
  let t = 1e12;
  const api = createApi(openDb(':memory:'), { password: 'powder-day-42', clock: () => t });
  let n = 0; // a brand-new phone for every request, so none is "already set up"
  const req = (pw, ip, extra = {}, auth = `Bearer new-${n++}:${'s'.repeat(20)}`) => {
    try {
      return api.handle('GET', '/v1/groups', { authorization: auth, 'x-server-password': pw, ...extra }, null, ip)[0];
    } catch (e) {
      return e.status;
    }
  };
  assert.equal(req('powder-day-42', '9.9.9.9', {}, anna.auth), 200); // anna's phone is set up
  for (let i = 0; i < 10; i++) assert.equal(req(`guess${i}`, '1.1.1.1'), 401);
  assert.equal(req('guess-more', '1.1.1.1'), 429);
  assert.equal(req('powder-day-42', '1.1.1.1'), 429, 'locked even with the right password');
  assert.equal(req('powder-day-42', '2.2.2.2'), 200, 'other IPs are unaffected');
  // Behind Cloudflare the real client IP comes in a header.
  for (let i = 0; i < 10; i++) req(`x${i}`, '127.0.0.1', { 'cf-connecting-ip': '3.3.3.3' });
  assert.equal(req('powder-day-42', '127.0.0.1', { 'cf-connecting-ip': '3.3.3.3' }), 429);
  assert.equal(req('powder-day-42', '127.0.0.1', { 'cf-connecting-ip': '4.4.4.4' }), 200);
  // After the window, the IP may try again.
  t += 15 * 60 * 1000 + 1;
  assert.equal(req('powder-day-42', '1.1.1.1'), 200);
  // Faking a new IP for every guess still runs into the global cap.
  for (let i = 0; i < 100; i++) assert.equal(req(`g${i}`, `10.0.0.${i}`), 401);
  assert.equal(req('another-guess', '10.0.1.1'), 429);
  assert.equal(req('powder-day-42', '10.0.1.1'), 429);
  // A phone that was already set up keeps working while strangers are locked out.
  assert.equal(req('powder-day-42', '1.1.1.1', {}, anna.auth), 200);
});

test('rejects junk', async () => {
  const res = await fetch(`${base}/v1/groups`, { method: 'POST', headers: { authorization: anna.auth }, body: '{nope' });
  assert.equal(res.status, 400);
  assert.equal((await call(anna, 'GET', '/v1/groups/x/board?date=yesterday')).status, 404);
  assert.equal((await call(anna, 'GET', '/v1/whatever')).status, 404);
});

test('a broken address is a 400, not a server error', async () => {
  const r = await call(anna, 'GET', '/v1/groups/%zz');
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'Invalid address');
});

test('an upload that is too big gets an answer, not a dropped connection', async () => {
  const res = await fetch(`${base}/v1/me/avatar`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: anna.auth },
    body: JSON.stringify({ jpeg: 'A'.repeat(9 * 1024 * 1024) }),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'Request too large');
  // The server still works afterwards.
  assert.equal((await call(anna, 'GET', '/v1/me')).status, 200);
});
