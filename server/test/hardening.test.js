import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApi } from '../src/app.js';
import { openDb } from '../src/db.js';

const auth = (id) => ({ authorization: `Bearer ${id}:secret-${id}-0123456789abcdef` });

/** Calls the API without HTTP (and without the one-second wrong-guess delay): returns [status, json]. */
function caller(api) {
  return (who, method, path, body, ip = '10.0.0.1') => {
    try {
      return api.handle(method, path, auth(who), body, ip);
    } catch (e) {
      return [e.status ?? 500, { error: e.message, code: e.code }];
    }
  };
}

test('wrong group codes are limited per client and per player, right ones still work for others', () => {
  let t = 1_000_000;
  const api = createApi(openDb(':memory:'), { clock: () => t });
  const call = caller(api);
  const [, g] = call('p-owner', 'POST', '/v1/groups', { name: 'Crew' });

  // A guesser gets 10 tries, then even the right code is refused for a while.
  for (let i = 0; i < 10; i++) {
    const [status, out] = call('p-guess', 'POST', '/v1/groups/join', { code: `ZZZZ${String(i).padStart(2, '2')}` }, '203.0.113.9');
    assert.equal(status, 404);
    assert.equal(out.code, 'join');
  }
  assert.equal(call('p-guess', 'POST', '/v1/groups/join', { code: g.code }, '203.0.113.9')[0], 429);
  // A new phone id from the same address doesn't help…
  assert.equal(call('p-guess-2', 'POST', '/v1/groups/join', { code: g.code }, '203.0.113.9')[0], 429);
  // …but someone else with the right code can still join.
  assert.equal(call('p-friend', 'POST', '/v1/groups/join', { code: g.code }, '198.51.100.7')[0], 200);

  // After the window the guesser may try again.
  t += 16 * 60 * 1000;
  assert.equal(call('p-guess', 'POST', '/v1/groups/join', { code: g.code }, '203.0.113.9')[0], 200);
});

test('wrong group codes from many addresses together are limited too', () => {
  const api = createApi(openDb(':memory:'));
  const call = caller(api);
  for (let i = 0; i < 200; i++) call(`p-bot-${i}`, 'POST', '/v1/groups/join', { code: 'ZZZZZZ' }, `192.0.2.${i % 250}-${i}`);
  assert.equal(call('p-bot-x', 'POST', '/v1/groups/join', { code: 'ZZZZZZ' }, '192.0.2.251')[0], 429);
});

test('with ADMIN_USERNAME, only that account becomes admin', () => {
  const db = openDb(':memory:');
  const call = caller(createApi(db, { adminUsername: 'Boss' }));
  const [, first] = call('p-early', 'POST', '/v1/account/register', { username: 'early', password: 'powder123' });
  assert.equal(first.isAdmin, false);
  const [, boss] = call('p-boss', 'POST', '/v1/account/register', { username: 'boss', password: 'powder123' });
  assert.equal(boss.isAdmin, true);
  assert.equal(call('p-early', 'GET', '/v1/admin/players')[0], 403);
});

test('ADMIN_USERNAME also promotes an account that already exists', () => {
  const db = openDb(':memory:');
  const call = caller(createApi(db));
  call('p-a', 'POST', '/v1/account/register', { username: 'anna', password: 'powder123' }); // first: admin
  call('p-b', 'POST', '/v1/account/register', { username: 'ben', password: 'powder123' });
  const again = caller(createApi(db, { adminUsername: 'ben' }));
  assert.equal(again('p-b', 'GET', '/v1/me')[1].isAdmin, true);
});
