import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The friends API. No accounts or passwords: each phone makes up a random
 * player id + secret the first time, and the server remembers a hash of the
 * secret. Every request carries "Authorization: Bearer <id>:<secret>".
 *
 * Everything is JSON under /v1. See ../README.md for the list of endpoints.
 */

const MAX_BODY = 256 * 1024;
const ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const MAX_GROUPS_PER_PLAYER = 20;
const MAX_MEMBERS = 50;
const MAX_PATH_POINTS = 150;
const MAX_GHOST = 64;

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Wrong server passwords are answered after this delay, so guessing is slow. */
export const WRONG_PASSWORD_DELAY_MS = 1000;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const now = () => Date.now();
const newId = () => `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;

function newCode() {
  const b = randomBytes(6);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, min, max) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, 'Invalid number');
  return v;
};
const id = (v, what = 'id') => {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, `Invalid ${what}`);
  return v;
};
const date = (v) => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw new HttpError(400, 'Invalid date (use YYYY-MM-DD)');
  return v;
};

function validPath(path) {
  if (!Array.isArray(path) || path.length < 2 || path.length > MAX_PATH_POINTS) throw new HttpError(400, 'Invalid challenge path');
  return path.map((p) => {
    if (!Array.isArray(p)) throw new HttpError(400, 'Invalid challenge path');
    const lat = num(p[0], -90, 90), lon = num(p[1], -180, 180);
    const alt = typeof p[2] === 'number' && Number.isFinite(p[2]) ? p[2] : null;
    return [lat, lon, alt];
  });
}

/**
 * `password`: the server password (SERVER_PASSWORD). When set, every request
 * except /v1/health must send it in the "X-Server-Password" header.
 */
export function createApi(db, { password = '' } = {}) {
  const passwordHash = password ? createHash('sha256').update(password).digest() : null;
  function checkPassword(given) {
    if (!passwordHash) return;
    const h = createHash('sha256').update(typeof given === 'string' ? given : '').digest();
    if (!timingSafeEqual(h, passwordHash)) throw new HttpError(401, 'Wrong server password', 'password');
  }

  const q = (sql) => db.prepare(sql);
  const stmt = {
    player: q('SELECT id, secret_hash, name FROM players WHERE id = ?'),
    addPlayer: q('INSERT INTO players (id, secret_hash, name, created_at) VALUES (?, ?, ?, ?)'),
    renamePlayer: q('UPDATE players SET name = ? WHERE id = ?'),
    groupById: q('SELECT id, name, code, created_by AS createdBy, created_at AS createdAt FROM groups WHERE id = ?'),
    groupByCode: q('SELECT id, name, code, created_by AS createdBy, created_at AS createdAt FROM groups WHERE code = ?'),
    addGroup: q('INSERT INTO groups (id, name, code, created_by, created_at) VALUES (?, ?, ?, ?, ?)'),
    renameGroup: q('UPDATE groups SET name = ? WHERE id = ?'),
    deleteGroup: q('DELETE FROM groups WHERE id = ?'),
    isMember: q('SELECT 1 AS ok FROM members WHERE group_id = ? AND player_id = ?'),
    addMember: q('INSERT OR IGNORE INTO members (group_id, player_id, joined_at) VALUES (?, ?, ?)'),
    removeMember: q('DELETE FROM members WHERE group_id = ? AND player_id = ?'),
    memberCount: q('SELECT COUNT(*) AS n FROM members WHERE group_id = ?'),
    groupCount: q('SELECT COUNT(*) AS n FROM members WHERE player_id = ?'),
    myGroups: q(`SELECT g.id, g.name, g.code, g.created_by AS createdBy, g.created_at AS createdAt,
                   (SELECT COUNT(*) FROM members m2 WHERE m2.group_id = g.id) AS members
                 FROM groups g JOIN members m ON m.group_id = g.id WHERE m.player_id = ? ORDER BY g.created_at DESC`),
    members: q(`SELECT p.id AS playerId, p.name, m.joined_at AS joinedAt FROM members m JOIN players p ON p.id = m.player_id
                WHERE m.group_id = ? ORDER BY m.joined_at`),
    upsertDay: q(`INSERT INTO days (player_id, day_id, date, started_at, vertical, top_speed, runs, distance, ski_time, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(player_id, day_id) DO UPDATE SET date = excluded.date, started_at = excluded.started_at,
                    vertical = excluded.vertical, top_speed = excluded.top_speed, runs = excluded.runs,
                    distance = excluded.distance, ski_time = excluded.ski_time, updated_at = excluded.updated_at`),
    deleteDay: q('DELETE FROM days WHERE player_id = ? AND day_id = ?'),
    groupDates: q(`SELECT DISTINCT d.date FROM days d JOIN members m ON m.player_id = d.player_id
                   WHERE m.group_id = ? ORDER BY d.date DESC LIMIT 60`),
    board: q(`SELECT p.id AS playerId, p.name,
                COALESCE(SUM(d.vertical), 0) AS vertical, COALESCE(MAX(d.top_speed), 0) AS topSpeed,
                COALESCE(SUM(d.runs), 0) AS runs, COALESCE(SUM(d.distance), 0) AS distance,
                COALESCE(SUM(d.ski_time), 0) AS skiTime, COUNT(d.day_id) AS days
              FROM members m JOIN players p ON p.id = m.player_id
              LEFT JOIN days d ON d.player_id = m.player_id AND d.date = ?
              WHERE m.group_id = ? GROUP BY p.id, p.name`),
    challenges: q(`SELECT c.id, c.segment_id AS segmentId, c.date, c.segment_json AS segment, c.created_by AS createdBy,
                     p.name AS createdByName, c.created_at AS createdAt
                   FROM challenges c JOIN players p ON p.id = c.created_by
                   WHERE c.group_id = ? ORDER BY c.date DESC, c.created_at DESC LIMIT 100`),
    challenge: q('SELECT id, group_id AS groupId, segment_id AS segmentId, date, created_by AS createdBy FROM challenges WHERE id = ?'),
    addChallenge: q(`INSERT INTO challenges (id, group_id, segment_id, date, segment_json, created_by, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`),
    sameChallenge: q('SELECT id FROM challenges WHERE group_id = ? AND segment_id = ? AND date = ?'),
    deleteChallenge: q('DELETE FROM challenges WHERE id = ?'),
    upsertAttempt: q(`INSERT INTO attempts (id, player_id, segment_id, date, time, at, ghost_json) VALUES (?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET time = excluded.time, date = excluded.date, at = excluded.at,
                        ghost_json = COALESCE(excluded.ghost_json, attempts.ghost_json)
                      WHERE attempts.player_id = excluded.player_id`),
    attemptOwner: q('SELECT player_id AS playerId FROM attempts WHERE id = ?'),
    challengeBoard: q(`SELECT a.id, a.player_id AS playerId, p.name AS playerName, a.time, a.at, a.ghost_json AS ghost
                       FROM attempts a JOIN members m ON m.player_id = a.player_id AND m.group_id = ?
                       JOIN players p ON p.id = a.player_id
                       WHERE a.segment_id = ? AND a.date = ? ORDER BY a.time`),
  };

  function auth(header) {
    const m = /^Bearer ([A-Za-z0-9._:-]{1,80}):([A-Za-z0-9_-]{16,128})$/.exec(header ?? '');
    if (!m) throw new HttpError(401, 'Missing or invalid Authorization header');
    const [, playerId, secret] = m;
    const hash = sha(secret);
    const row = stmt.player.get(playerId);
    if (!row) {
      stmt.addPlayer.run(playerId, hash, 'Skier', now());
      return { id: playerId, name: 'Skier' };
    }
    const a = Buffer.from(row.secret_hash, 'hex'), b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'This player id belongs to another phone');
    return { id: row.id, name: row.name };
  }

  function memberOf(groupId, me) {
    const g = stmt.groupById.get(id(groupId, 'group'));
    if (!g || !stmt.isMember.get(g.id, me.id)) throw new HttpError(404, 'Group not found');
    return g;
  }

  function join(g, me) {
    if (stmt.isMember.get(g.id, me.id)) return;
    if (stmt.groupCount.get(me.id).n >= MAX_GROUPS_PER_PLAYER) throw new HttpError(400, `You can be in at most ${MAX_GROUPS_PER_PLAYER} groups`);
    if (stmt.memberCount.get(g.id).n >= MAX_MEMBERS) throw new HttpError(400, 'This group is full');
    stmt.addMember.run(g.id, me.id, now());
  }

  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const parseChallenge = (c) => ({ ...c, segment: JSON.parse(c.segment) });

  // [method, path regex, handler(me, params, body, query)]
  const routes = [
    ['PUT', /^\/v1\/me$/, (me, _p, body) => {
      const name = str(body?.name, 30) || 'Skier';
      stmt.renamePlayer.run(name, me.id);
      return { id: me.id, name };
    }],

    ['GET', /^\/v1\/groups$/, (me) => stmt.myGroups.all(me.id)],

    ['POST', /^\/v1\/groups$/, (me, _p, body) => {
      const name = str(body?.name, 40);
      if (!name) throw new HttpError(400, 'Give the group a name');
      return tx(() => {
        let code = newCode();
        while (stmt.groupByCode.get(code)) code = newCode();
        const g = { id: newId(), name, code, createdBy: me.id, createdAt: now() };
        if (stmt.groupCount.get(me.id).n >= MAX_GROUPS_PER_PLAYER) throw new HttpError(400, `You can be in at most ${MAX_GROUPS_PER_PLAYER} groups`);
        stmt.addGroup.run(g.id, g.name, g.code, g.createdBy, g.createdAt);
        stmt.addMember.run(g.id, me.id, g.createdAt);
        return { ...g, members: 1 };
      });
    }],

    ['POST', /^\/v1\/groups\/join$/, (me, _p, body) => {
      const code = str(body?.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const g = code ? stmt.groupByCode.get(code) : null;
      if (!g) throw new HttpError(404, 'No group with that code');
      join(g, me);
      return { ...g, members: stmt.memberCount.get(g.id).n };
    }],

    ['GET', /^\/v1\/groups\/([^/]+)$/, (me, [gid]) => {
      const g = memberOf(gid, me);
      return {
        ...g,
        members: stmt.members.all(g.id),
        dates: stmt.groupDates.all(g.id).map((r) => r.date),
        challenges: stmt.challenges.all(g.id).map(parseChallenge),
      };
    }],

    ['PATCH', /^\/v1\/groups\/([^/]+)$/, (me, [gid], body) => {
      const g = memberOf(gid, me);
      const name = str(body?.name, 40);
      if (!name) throw new HttpError(400, 'Give the group a name');
      stmt.renameGroup.run(name, g.id);
      return { ...g, name };
    }],

    ['DELETE', /^\/v1\/groups\/([^/]+)\/members\/me$/, (me, [gid]) => {
      const g = memberOf(gid, me);
      tx(() => {
        stmt.removeMember.run(g.id, me.id);
        if (stmt.memberCount.get(g.id).n === 0) stmt.deleteGroup.run(g.id);
      });
      return { ok: true };
    }],

    ['GET', /^\/v1\/groups\/([^/]+)\/board$/, (me, [gid], _b, query) => {
      const g = memberOf(gid, me);
      const d = date(query.get('date'));
      return { date: d, rows: stmt.board.all(d, g.id) };
    }],

    ['POST', /^\/v1\/groups\/([^/]+)\/challenges$/, (me, [gid], body) => {
      const g = memberOf(gid, me);
      const d = date(body?.date);
      const s = body?.segment ?? {};
      const segment = {
        id: id(s.id, 'challenge id'),
        name: str(s.name, 30) || 'Challenge',
        path: validPath(s.path),
        gateRadius: num(s.gateRadius ?? 30, 10, 100),
        creatorName: str(s.creatorName, 30) || me.name,
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : now(),
      };
      const dup = stmt.sameChallenge.get(g.id, segment.id, d);
      if (dup) throw new HttpError(409, 'This stretch is already the group challenge for that day');
      const c = { id: newId(), segmentId: segment.id, date: d, createdBy: me.id, createdByName: me.name, createdAt: now() };
      stmt.addChallenge.run(c.id, g.id, segment.id, d, JSON.stringify(segment), me.id, c.createdAt);
      return { ...c, segment };
    }],

    ['DELETE', /^\/v1\/groups\/([^/]+)\/challenges\/([^/]+)$/, (me, [gid, cid]) => {
      const g = memberOf(gid, me);
      const c = stmt.challenge.get(cid);
      if (!c || c.groupId !== g.id) throw new HttpError(404, 'Challenge not found');
      if (c.createdBy !== me.id && g.createdBy !== me.id) throw new HttpError(403, 'Only who set it (or the group owner) can remove it');
      stmt.deleteChallenge.run(c.id);
      return { ok: true };
    }],

    ['GET', /^\/v1\/groups\/([^/]+)\/challenges\/([^/]+)\/board$/, (me, [gid, cid]) => {
      const g = memberOf(gid, me);
      const c = stmt.challenge.get(cid);
      if (!c || c.groupId !== g.id) throw new HttpError(404, 'Challenge not found');
      // Each member's best time on that day.
      const best = new Map();
      for (const a of stmt.challengeBoard.all(g.id, c.segmentId, c.date)) {
        if (!best.has(a.playerId)) best.set(a.playerId, { ...a, ghost: a.ghost ? JSON.parse(a.ghost) : null });
      }
      return { challengeId: c.id, date: c.date, rows: [...best.values()] };
    }],

    ['PUT', /^\/v1\/days\/([^/]+)$/, (me, [dayId], body) => {
      id(dayId, 'day id');
      stmt.upsertDay.run(
        me.id, dayId, date(body?.date), num(body?.startedAt, 0, 1e14),
        num(body?.vertical, 0, 1e6), num(body?.topSpeed, 0, 100), Math.round(num(body?.runs, 0, 10000)),
        num(body?.distance, 0, 1e7), num(body?.skiTime, 0, 1e6), now(),
      );
      return { ok: true };
    }],

    ['DELETE', /^\/v1\/days\/([^/]+)$/, (me, [dayId]) => {
      stmt.deleteDay.run(me.id, id(dayId, 'day id'));
      return { ok: true };
    }],

    ['PUT', /^\/v1\/attempts\/([^/]+)$/, (me, [aid], body) => {
      id(aid, 'attempt id');
      const owner = stmt.attemptOwner.get(aid);
      if (owner && owner.playerId !== me.id) throw new HttpError(403, 'Not your attempt');
      const ghost = Array.isArray(body?.ghost) && body.ghost.length <= MAX_GHOST && body.ghost.every((x) => typeof x === 'number' && Number.isFinite(x))
        ? JSON.stringify(body.ghost) : null;
      stmt.upsertAttempt.run(aid, me.id, id(body?.segmentId, 'challenge id'), date(body?.date), num(body?.time, 0.5, 36000), num(body?.at, 0, 1e14), ghost);
      return { ok: true };
    }],
  ];

  /** Handles one request; returns [status, json]. */
  function handle(method, url, headers, body) {
    const u = new URL(url, 'http://x');
    if (method === 'GET' && u.pathname === '/v1/health') {
      return [200, { ok: true, app: 'ski-tracker-friends', v: 1, password: !!passwordHash }];
    }
    for (const [m, re, fn] of routes) {
      if (m !== method) continue;
      const match = re.exec(u.pathname);
      if (!match) continue;
      checkPassword(headers['x-server-password']);
      const me = auth(headers.authorization);
      return [200, fn(me, match.slice(1).map(decodeURIComponent), body, u.searchParams)];
    }
    throw new HttpError(404, 'Not found');
  }

  return { handle };
}

/** Node http listener around the API. */
export function listener(api, log = () => undefined) {
  return (req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Request too large' }));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let status = 200, out, delay = 0;
      try {
        let body = null;
        if (chunks.length) {
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            throw new HttpError(400, 'Body must be JSON');
          }
        }
        [status, out] = api.handle(req.method, req.url, req.headers, body);
      } catch (e) {
        status = e instanceof HttpError ? e.status : 500;
        out = { error: e instanceof HttpError ? e.message : 'Server error', ...(e?.code ? { code: e.code } : {}) };
        if (e?.code === 'password') delay = WRONG_PASSWORD_DELAY_MS;
        if (!(e instanceof HttpError)) log(e);
      }
      const send = () => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(out));
      if (delay) setTimeout(send, delay);
      else send();
    });
  };
}
