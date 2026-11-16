import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createApi, listener } from '../src/app.js';
import { openDb } from '../src/db.js';

// The server's clock is ours to move: Saturday 17 January 2026, 10:00 UTC.
const START = Date.UTC(2026, 0, 17, 10);
const HOUR = 3600 * 1000;
let now = START;

let base, server;
before(async () => {
  server = createServer(listener(createApi(openDb(':memory:'), { clock: () => now })));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const player = (id) => ({ auth: `Bearer ${id}:secret-${id}-0123456789abcdef` });
async function call(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: who.auth },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

const anna = player('p-anna'), ben = player('p-ben'), cas = player('p-cas');
const TOP = { lat: 47.01, lon: 10.29 };
let gid;
const liveOf = async (who) => (await call(who, 'GET', `/v1/groups/${gid}/live`)).json;

test('members see where the others are, for ten minutes', async () => {
  for (const [p, name] of [[anna, 'Anna'], [ben, 'Ben'], [cas, 'Cas']]) await call(p, 'PUT', '/v1/me', { name });
  const g = (await call(anna, 'POST', '/v1/groups', { name: 'Ischgl 2026' })).json;
  gid = g.id;
  await call(ben, 'POST', '/v1/groups/join', { code: g.code });

  assert.equal((await call(anna, 'POST', '/v1/live', TOP)).status, 200);
  assert.equal((await call(anna, 'POST', '/v1/live', { lat: 91, lon: 0 })).status, 400);
  await call(cas, 'POST', '/v1/live', { lat: 46, lon: 9 }); // not in the group

  assert.deepEqual((await liveOf(ben)).members, [{ playerId: 'p-anna', name: 'Anna', ...TOP, at: START }]);
  assert.deepEqual((await liveOf(anna)).members, []); // never yourself
  assert.equal((await call(cas, 'GET', `/v1/groups/${gid}/live`)).status, 404);

  now = START + 11 * 60 * 1000;
  assert.deepEqual((await liveOf(ben)).members, []);

  await call(anna, 'POST', '/v1/live', TOP);
  assert.equal((await liveOf(ben)).members.length, 1);
  await call(anna, 'DELETE', '/v1/live');
  assert.deepEqual((await liveOf(ben)).members, []);
  now = START;
});

test('one meet-up pin per group: members set it, only its setter clears it', async () => {
  assert.equal((await liveOf(anna)).pin, null);
  const pin = { ...TOP, label: '  Lunch at the top of the Gondola ', meetAt: START + 2.5 * HOUR };

  assert.equal((await call(cas, 'POST', `/v1/groups/${gid}/pin`, pin)).status, 404);
  assert.equal((await call(anna, 'POST', `/v1/groups/${gid}/pin`, { ...pin, lat: 'north' })).status, 400);
  assert.equal((await call(anna, 'POST', `/v1/groups/${gid}/pin`, { ...pin, meetAt: START - 3 * HOUR })).status, 400);
  assert.equal((await call(anna, 'POST', `/v1/groups/${gid}/pin`, { ...pin, meetAt: START + 25 * HOUR })).status, 400);

  const set = await call(anna, 'POST', `/v1/groups/${gid}/pin`, pin);
  assert.equal(set.status, 200);
  const want = {
    ...TOP, label: 'Lunch at the top of the Gondola', meetAt: pin.meetAt,
    createdBy: 'p-anna', createdByName: 'Anna', createdAt: START, expiresAt: pin.meetAt + 2 * HOUR,
  };
  assert.deepEqual(set.json, { ...want, mine: true });
  assert.deepEqual((await liveOf(anna)).pin, { ...want, mine: true });
  assert.deepEqual((await liveOf(ben)).pin, { ...want, mine: false });

  // Ben can't clear Anna's pin, but he can put his own in its place.
  assert.equal((await call(ben, 'DELETE', `/v1/groups/${gid}/pin`)).status, 403);
  assert.equal((await call(cas, 'DELETE', `/v1/groups/${gid}/pin`)).status, 404);
  now = START + 1000;
  await call(ben, 'POST', `/v1/groups/${gid}/pin`, { lat: 47.02, lon: 10.3, label: '' });
  const replaced = (await liveOf(anna)).pin;
  assert.deepEqual(
    [replaced.label, replaced.meetAt, replaced.createdByName, replaced.createdAt, replaced.mine],
    ['Meet here', null, 'Ben', START + 1000, false],
  );
  assert.equal((await call(anna, 'DELETE', `/v1/groups/${gid}/pin`)).status, 403);
  assert.equal((await call(ben, 'DELETE', `/v1/groups/${gid}/pin`)).status, 200);
  assert.equal((await liveOf(anna)).pin, null);
  now = START;
});

test('a pin with a time is gone two hours after it', async () => {
  await call(anna, 'POST', `/v1/groups/${gid}/pin`, { ...TOP, label: 'Lunch', meetAt: START + HOUR });
  now = START + 3 * HOUR - 1;
  assert.equal((await liveOf(ben)).pin.label, 'Lunch');
  now = START + 3 * HOUR;
  assert.equal((await liveOf(ben)).pin, null);
  // An expired pin is nobody's to guard: clearing it is fine, and so is setting a new one.
  assert.equal((await call(ben, 'DELETE', `/v1/groups/${gid}/pin`)).status, 200);
  now = START;
});

test('a pin without a time is gone at the end of the setter’s day', async () => {
  // 10:00 UTC is 11:00 in the Alps (UTC+1, so getTimezoneOffset() is -60): midnight there is 23:00 UTC.
  const set = (await call(anna, 'POST', `/v1/groups/${gid}/pin`, { ...TOP, label: 'Car park', tzOffset: -60 })).json;
  assert.equal(set.expiresAt, Date.UTC(2026, 0, 17, 23));
  now = set.expiresAt - 1;
  assert.equal((await liveOf(ben)).pin.label, 'Car park');
  now = set.expiresAt;
  assert.equal((await liveOf(ben)).pin, null);
  now = START;

  // No offset sent: the day ends at midnight UTC.
  assert.equal((await call(anna, 'POST', `/v1/groups/${gid}/pin`, { ...TOP, label: 'Car park' })).json.expiresAt, Date.UTC(2026, 0, 18));
  assert.equal((await call(anna, 'POST', `/v1/groups/${gid}/pin`, { ...TOP, label: 'x', tzOffset: 9999 })).status, 400);
});

test('leaving the group takes your pin with you', async () => {
  await call(ben, 'POST', `/v1/groups/${gid}/pin`, { ...TOP, label: 'Après' });
  assert.equal((await liveOf(anna)).pin.label, 'Après');
  await call(ben, 'DELETE', `/v1/groups/${gid}/members/me`);
  assert.equal((await liveOf(anna)).pin, null);
});
