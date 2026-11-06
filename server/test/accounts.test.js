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

const phone = (id) => ({ auth: `Bearer ${id}:secret-${id}-0123456789abcdef` });
async function call(who, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: who.auth },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

const rafPhone1 = phone('d-raf-1'), rafPhone2 = phone('d-raf-2'), tomPhone = phone('d-tom'), evePhone = phone('d-eve');

test('first account is admin; usernames are unique', async () => {
  const r = await call(rafPhone1, 'POST', '/v1/account/register', { username: 'Rafha', password: 'powder123', name: 'Raf' });
  assert.equal(r.status, 200);
  assert.equal(r.json.username, 'rafha');
  assert.equal(r.json.isAdmin, true);
  assert.equal((await call(tomPhone, 'POST', '/v1/account/register', { username: 'rafha', password: 'whatever1' })).status, 409);
  assert.equal((await call(tomPhone, 'POST', '/v1/account/register', { username: 'x', password: 'whatever1' })).status, 400);
  assert.equal((await call(tomPhone, 'POST', '/v1/account/register', { username: 'tom', password: '123' })).status, 400);
  const t = await call(tomPhone, 'POST', '/v1/account/register', { username: 'tom', password: 'tomtom1', name: 'Tom' });
  assert.equal(t.json.isAdmin, false);
});

test('logging in on a second phone makes it the same skier, bringing its groups along', async () => {
  // Phone 2 was used without an account: it made a group and shared a day.
  const g = (await call(rafPhone2, 'POST', '/v1/groups', { name: 'Trip' })).json;
  await call(rafPhone2, 'PUT', '/v1/days/day-x', { date: '2026-01-17', startedAt: 1, vertical: 4000, topSpeed: 20, runs: 10, distance: 1000, skiTime: 100 });
  const wrong = await call(rafPhone2, 'POST', '/v1/account/login', { username: 'rafha', password: 'nope-nope' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.code, 'login');
  const ok = await call(rafPhone2, 'POST', '/v1/account/login', { username: 'RAFHA', password: 'powder123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.id, 'd-raf-1');
  // Both phones are now the same skier, and the group came along.
  assert.equal((await call(rafPhone2, 'GET', '/v1/me')).json.username, 'rafha');
  assert.deepEqual((await call(rafPhone1, 'GET', '/v1/groups')).json.map((x) => x.id), [g.id]);
  const board = (await call(rafPhone1, 'GET', `/v1/groups/${g.id}/board?date=2026-01-17`)).json.rows;
  assert.equal(board.length, 1);
  assert.equal(board[0].vertical, 4000);
});

test('online backup of days, only for accounts', async () => {
  assert.equal((await call(evePhone, 'GET', '/v1/me/tracks')).status, 403);
  const data = Buffer.from('pretend this is a gzipped track').toString('base64');
  assert.equal((await call(rafPhone2, 'PUT', '/v1/me/tracks/day-1', { startedAt: 5, endedAt: 9, place: 'Kaprun', sport: 'ski', data })).status, 200);
  const list = (await call(rafPhone1, 'GET', '/v1/me/tracks')).json;
  assert.deepEqual(list.map((t) => [t.dayId, t.place, t.size]), [['day-1', 'Kaprun', data.length]]);
  assert.equal((await call(rafPhone1, 'GET', '/v1/me/tracks/day-1')).json.data, data);
  // Other people can't read it.
  assert.equal((await call(tomPhone, 'GET', '/v1/me/tracks/day-1')).status, 404);
  assert.equal((await call(rafPhone1, 'PUT', '/v1/me/tracks/day-2', { startedAt: 5, data: 'not base64!' })).status, 400);
});

test('profiles: only visible to people in a group with you', async () => {
  const pic = Buffer.from('jpeg-bytes').toString('base64');
  await call(rafPhone1, 'PUT', '/v1/me/avatar', { jpeg: pic });
  await call(rafPhone1, 'PUT', '/v1/me/profile', { badges: [{ id: 'speed-60', emoji: '💨', title: 'Fast lane', at: 1 }] });
  // Tom isn't in a group with Raf yet.
  assert.equal((await call(tomPhone, 'GET', '/v1/players/d-raf-1')).status, 404);
  const g = (await call(rafPhone1, 'GET', '/v1/groups')).json[0];
  const detail = (await call(rafPhone1, 'GET', `/v1/groups/${g.id}`)).json;
  await call(tomPhone, 'POST', '/v1/groups/join', { code: detail.code });
  const p = (await call(tomPhone, 'GET', '/v1/players/d-raf-1')).json;
  assert.equal(p.username, 'rafha');
  assert.equal(p.hasAvatar, true);
  assert.equal(p.allTime.vertical, 4000);
  assert.deepEqual(p.badges.map((b) => b.title), ['Fast lane']);
  assert.equal((await call(tomPhone, 'GET', '/v1/players/d-raf-1/avatar')).json.jpeg, pic);
  const members = (await call(tomPhone, 'GET', `/v1/groups/${g.id}`)).json.members;
  assert.ok(members.some((m) => m.username === 'rafha' && m.hasAvatar));
});

test('admin sees everyone and can remove a skier', async () => {
  assert.equal((await call(tomPhone, 'GET', '/v1/admin/players')).status, 403);
  await call(evePhone, 'PUT', '/v1/me', { name: 'Eve' });
  const list = (await call(rafPhone1, 'GET', '/v1/admin/players')).json;
  const byName = Object.fromEntries(list.map((p) => [p.name, p]));
  assert.equal(byName.Raf.isAdmin, true);
  assert.equal(byName.Raf.phones, 2);
  assert.equal(byName.Raf.backups, 1);
  assert.equal(byName.Tom.groups, 1);
  assert.equal((await call(rafPhone1, 'DELETE', '/v1/admin/players/d-raf-1')).status, 400);
  assert.equal((await call(rafPhone1, 'DELETE', '/v1/admin/players/d-tom')).status, 200);
  // Tom's phone no longer gets in, and he's out of the group.
  assert.equal((await call(tomPhone, 'GET', '/v1/me')).status, 401);
  const g = (await call(rafPhone1, 'GET', '/v1/groups')).json[0];
  assert.equal(g.members, 1);
});

test('log out, change password, and too many wrong passwords', async () => {
  await call(rafPhone2, 'POST', '/v1/account/logout');
  // Phone 2 is no longer logged in: it's just an anonymous skier again.
  assert.equal((await call(rafPhone2, 'GET', '/v1/me')).json.username, null);
  const fresh = phone('d-raf-2b');
  assert.equal((await call(rafPhone1, 'PUT', '/v1/account/password', { old: 'wrong-one', password: 'newpass1' })).status, 401);
  assert.equal((await call(rafPhone1, 'PUT', '/v1/account/password', { old: 'powder123', password: 'newpass1' })).status, 200);
  assert.equal((await call(fresh, 'POST', '/v1/account/login', { username: 'rafha', password: 'powder123' })).status, 401);
  assert.equal((await call(fresh, 'POST', '/v1/account/login', { username: 'rafha', password: 'newpass1' })).status, 200);
  const guesser = phone('d-guess');
  for (let i = 0; i < 8; i++) await call(guesser, 'POST', '/v1/account/login', { username: 'eve-x', password: `guess${i}xx` });
  assert.equal((await call(guesser, 'POST', '/v1/account/login', { username: 'eve-x', password: 'guess9xx' })).status, 429);
});

test('changing the password logs out the other phones, not this one', async () => {
  const other = phone('d-raf-3');
  assert.equal((await call(other, 'POST', '/v1/account/login', { username: 'rafha', password: 'newpass1' })).status, 200);
  assert.equal((await call(other, 'GET', '/v1/me')).json.username, 'rafha');
  assert.equal((await call(rafPhone1, 'PUT', '/v1/account/password', { old: 'newpass1', password: 'newpass2' })).status, 200);
  assert.equal((await call(rafPhone1, 'GET', '/v1/me')).json.username, 'rafha');
  // Someone else using that phone's id isn't told (and can't take the id)...
  const fake = await call({ auth: 'Bearer d-raf-3:not-the-secret-0123456789' }, 'GET', '/v1/me');
  assert.equal(fake.status, 401);
  assert.notEqual(fake.json.code, 'logged_out');
  // ...the other phones are told once that they were logged out...
  for (const p of [other, phone('d-raf-2b')]) {
    const r = await call(p, 'GET', '/v1/me');
    assert.equal(r.status, 401);
    assert.equal(r.json.code, 'logged_out');
  }
  // ...then their tokens no longer reach the account, and a fresh id works.
  assert.equal((await call(other, 'GET', '/v1/me')).json.username, null);
  assert.equal((await call(phone('d-raf-3-new'), 'GET', '/v1/me')).status, 200);
});

test('an old database upgrades: existing players keep working', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { createHash } = await import('node:crypto');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'ski-')), 'old.db');
  // The database as version 1 of the server made it.
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE players (id TEXT PRIMARY KEY NOT NULL, secret_hash TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Skier', created_at INTEGER NOT NULL)`);
  old.prepare('INSERT INTO players VALUES (?, ?, ?, ?)').run('p-old', createHash('sha256').update('secret-p-old-0123456789abcdef').digest('hex'), 'Oldie', 1);
  old.close();
  const api = createApi(openDb(file));
  const [status, me] = api.handle('GET', '/v1/me', { authorization: 'Bearer p-old:secret-p-old-0123456789abcdef' }, null);
  assert.equal(status, 200);
  assert.equal(me.name, 'Oldie');
  assert.throws(() => api.handle('GET', '/v1/me', { authorization: 'Bearer p-old:secret-wrong-0123456789abcdef' }, null), /another phone/);
  // Opening it again doesn't redo the upgrade.
  createApi(openDb(file));
});
