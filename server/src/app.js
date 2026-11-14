import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * The friends API. Each phone makes up a random device id + secret the first
 * time, and the server remembers a hash of the secret. Every request carries
 * "Authorization: Bearer <device id>:<secret>". A phone starts as an anonymous
 * player; creating an account (username + password) or logging in to one ties
 * the phone to that player, so several phones can be the same person.
 *
 * Everything is JSON under /v1. See ../README.md for the list of endpoints.
 */

const MAX_BODY = 8 * 1024 * 1024; // a day's GPS track (compressed) can be a few MB
const ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const MAX_GROUPS_PER_PLAYER = 20;
const MAX_MEMBERS = 50;
const MAX_PATH_POINTS = 150;
const MAX_GHOST = 64;
const USERNAME_RE = /^[a-z0-9_.-]{3,20}$/;
const MAX_AVATAR = 200 * 1000; // base64 characters (~150 KB JPEG)
const MAX_TRACK = 6 * 1000 * 1000; // base64 characters
const LOGIN_FAILS = 8; // wrong passwords per username…
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // …within this window lock it for the rest of the window
const SERVER_PW_FAILS_PER_IP = 10; // wrong server passwords per client IP per window…
const SERVER_PW_FAILS_TOTAL = 100; // …and from everyone together (so faking IPs doesn't help)

/** Counts failures per key; once a key has `max` within `windowMs` of its first, check() throws 429. */
function failLimit(max, windowMs, clock, message) {
  const m = new Map(); // key -> { n, first }
  let swept = clock();
  return {
    check(key) {
      const f = m.get(key);
      if (f && clock() - f.first > windowMs) m.delete(key);
      else if (f && f.n >= max) throw new HttpError(429, message);
    },
    fail(key) {
      const t = clock();
      if (t - swept > windowMs) { // drop old entries now and then so the map can't grow forever
        swept = t;
        for (const [k, f] of m) if (t - f.first > windowMs) m.delete(k);
      }
      const f = m.get(key);
      if (f && t - f.first <= windowMs) f.n++;
      else m.set(key, { n: 1, first: t });
    },
    clear: (key) => m.delete(key),
  };
}

function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`;
}

function checkPasswordHash(pw, stored) {
  const [kind, saltHex, hashHex] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const got = scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(hashHex, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Start of the ski season (1 July) that `date` falls in, as YYYY-MM-DD. */
function seasonStart(ms) {
  const d = new Date(ms);
  const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return [`${y}-07-01`, `${y + 1}-07-01`, `${y}/${String((y + 1) % 100).padStart(2, '0')}`];
}

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
export function createApi(db, { password = '', clock = Date.now } = {}) {
  const passwordHash = password ? createHash('sha256').update(password).digest() : null;
  const tooMany = 'Too many wrong passwords. Try again in 15 minutes.';
  const ipFails = failLimit(SERVER_PW_FAILS_PER_IP, LOGIN_WINDOW_MS, clock, tooMany);
  const allFails = failLimit(SERVER_PW_FAILS_TOTAL, LOGIN_WINDOW_MS, clock, tooMany);
  function checkPassword(given, ip, known) {
    if (!passwordHash) return;
    // Phones already set up on this server aren't locked out by someone else's guessing.
    if (!known) {
      ipFails.check(ip);
      allFails.check('');
    }
    const h = createHash('sha256').update(typeof given === 'string' ? given : '').digest();
    if (!timingSafeEqual(h, passwordHash)) {
      ipFails.fail(ip);
      allFails.fail('');
      throw new HttpError(401, 'Wrong server password', 'password');
    }
  }

  const q = (sql) => db.prepare(sql);
  const stmt = {
    player: q('SELECT id, name, username, pass_hash, is_admin, last_seen, avatar IS NOT NULL AS hasAvatar FROM players WHERE id = ?'),
    byUsername: q('SELECT id, name, username, pass_hash, is_admin FROM players WHERE username = ?'),
    addPlayer: q('INSERT INTO players (id, secret_hash, name, created_at) VALUES (?, ?, ?, ?)'),
    device: q('SELECT id, secret_hash, player_id FROM devices WHERE id = ?'),
    addDevice: q('INSERT INTO devices (id, secret_hash, player_id, created_at) VALUES (?, ?, ?, ?)'),
    moveDevice: q('UPDATE devices SET player_id = ? WHERE id = ?'),
    deleteDevice: q('DELETE FROM devices WHERE id = ?'),
    deleteOtherDevices: q('DELETE FROM devices WHERE player_id = ? AND id != ?'),
    removedDevice: q('SELECT 1 AS ok FROM removed_devices WHERE id = ?'),
    logOutOtherDevices: q('INSERT OR REPLACE INTO logged_out_devices (id, secret_hash) SELECT id, secret_hash FROM devices WHERE player_id = ? AND id != ?'),
    loggedOutDevice: q('SELECT secret_hash FROM logged_out_devices WHERE id = ?'),
    forgetLoggedOut: q('DELETE FROM logged_out_devices WHERE id = ?'),
    deviceCount: q('SELECT COUNT(*) AS n FROM devices WHERE player_id = ?'),
    touch: q('UPDATE players SET last_seen = ? WHERE id = ?'),
    register: q('UPDATE players SET username = ?, pass_hash = ?, name = ?, is_admin = ? WHERE id = ?'),
    setPassword: q('UPDATE players SET pass_hash = ? WHERE id = ?'),
    anyAdmin: q('SELECT 1 AS ok FROM players WHERE is_admin = 1 LIMIT 1'),
    setAvatar: q('UPDATE players SET avatar = ? WHERE id = ?'),
    avatar: q('SELECT avatar FROM players WHERE id = ?'),
    setProfile: q('UPDATE players SET profile_json = ? WHERE id = ?'),
    profile: q('SELECT id, name, username, avatar IS NOT NULL AS hasAvatar, profile_json AS profile, created_at AS createdAt FROM players WHERE id = ?'),
    sharesGroup: q('SELECT 1 AS ok FROM members a JOIN members b ON a.group_id = b.group_id WHERE a.player_id = ? AND b.player_id = ? LIMIT 1'),
    totals: q(`SELECT COUNT(DISTINCT date) AS days, COALESCE(SUM(vertical), 0) AS vertical, COALESCE(MAX(top_speed), 0) AS topSpeed,
                 COALESCE(SUM(runs), 0) AS runs, COALESCE(SUM(distance), 0) AS distance, COALESCE(SUM(ski_time), 0) AS skiTime
               FROM days WHERE player_id = ? AND date >= ? AND date < ?`),
    recentDays: q(`SELECT date, SUM(vertical) AS vertical, MAX(top_speed) AS topSpeed, SUM(runs) AS runs FROM days
                   WHERE player_id = ? GROUP BY date ORDER BY date DESC LIMIT 8`),
    upsertTrack: q(`INSERT INTO tracks (player_id, day_id, started_at, ended_at, place, sport, data, size, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(player_id, day_id) DO UPDATE SET started_at = excluded.started_at, ended_at = excluded.ended_at,
                      place = excluded.place, sport = excluded.sport, data = excluded.data, size = excluded.size, updated_at = excluded.updated_at`),
    tracks: q(`SELECT day_id AS dayId, started_at AS startedAt, ended_at AS endedAt, place, sport, size, updated_at AS updatedAt
               FROM tracks WHERE player_id = ? ORDER BY started_at DESC`),
    track: q(`SELECT day_id AS dayId, started_at AS startedAt, ended_at AS endedAt, place, sport, data FROM tracks
              WHERE player_id = ? AND day_id = ?`),
    deleteTrack: q('DELETE FROM tracks WHERE player_id = ? AND day_id = ?'),
    adminPlayers: q(`SELECT p.id, p.name, p.username, p.is_admin AS isAdmin, p.last_seen AS lastSeen, p.created_at AS createdAt,
                       p.avatar IS NOT NULL AS hasAvatar,
                       (SELECT COUNT(*) FROM members m WHERE m.player_id = p.id) AS groups,
                       (SELECT COUNT(DISTINCT date) FROM days d WHERE d.player_id = p.id) AS days,
                       (SELECT COUNT(*) FROM tracks t WHERE t.player_id = p.id) AS backups,
                       (SELECT COALESCE(SUM(size), 0) FROM tracks t WHERE t.player_id = p.id) AS backupBytes,
                       (SELECT COUNT(*) FROM devices v WHERE v.player_id = p.id) AS phones
                     FROM players p ORDER BY p.username IS NULL, p.last_seen DESC`),
    setAdmin: q('UPDATE players SET is_admin = ? WHERE id = ?'),
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
    members: q(`SELECT p.id AS playerId, p.name, p.username, p.avatar IS NOT NULL AS hasAvatar, m.joined_at AS joinedAt
                FROM members m JOIN players p ON p.id = m.player_id
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

  const sameHash = (x, y) => {
    const a = Buffer.from(x, 'hex'), b = Buffer.from(y, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  };

  /** Reads the Authorization header and looks the phone up, once per request. */
  function credentials(header) {
    const m = /^Bearer ([A-Za-z0-9._-]{1,80}):([A-Za-z0-9_-]{16,128})$/.exec(header ?? '');
    if (!m) return null;
    const hash = sha(m[2]);
    const dev = stmt.device.get(m[1]);
    // known: an existing phone with its right secret.
    return { deviceId: m[1], hash, dev, known: !!dev && sameHash(dev.secret_hash, hash) };
  }

  function auth(cred) {
    if (!cred) throw new HttpError(401, 'Missing or invalid Authorization header');
    const { deviceId, hash, dev } = cred;
    if (!dev) {
      if (stmt.removedDevice.get(deviceId)) throw new HttpError(401, 'This phone was removed from the server');
      const out = stmt.loggedOutDevice.get(deviceId);
      if (out) {
        if (!sameHash(out.secret_hash, hash)) throw new HttpError(401, 'This player id belongs to another phone');
        // Told once; the app then starts again with a fresh id.
        stmt.forgetLoggedOut.run(deviceId);
        throw new HttpError(401, 'Your password was changed on another phone. Log in again.', 'logged_out');
      }
      // A new phone: it starts as its own, anonymous player.
      if (stmt.player.get(deviceId)) throw new HttpError(401, 'This player id belongs to another phone');
      tx(() => {
        stmt.addPlayer.run(deviceId, hash, 'Skier', now());
        stmt.addDevice.run(deviceId, hash, deviceId, now());
      });
      return { id: deviceId, deviceId, name: 'Skier', username: null, isAdmin: false };
    }
    if (!cred.known) throw new HttpError(401, 'This player id belongs to another phone');
    const p = stmt.player.get(dev.player_id);
    if (!p) throw new HttpError(401, 'This account was removed');
    if (!p.last_seen || now() - p.last_seen > 5 * 60 * 1000) stmt.touch.run(now(), p.id);
    return { id: p.id, deviceId, name: p.name, username: p.username, isAdmin: !!p.is_admin };
  }

  const meInfo = (me) => {
    const p = stmt.player.get(me.id);
    return { id: p.id, name: p.name, username: p.username, isAdmin: !!p.is_admin, hasAvatar: !!p.hasAvatar };
  };

  const fails = failLimit(LOGIN_FAILS, LOGIN_WINDOW_MS, clock, tooMany); // per username
  const loginAllowed = (username) => fails.check(username);
  function loginFailed(username) {
    fails.fail(username);
    throw new HttpError(401, 'Wrong username or password', 'login');
  }

  const cleanUsername = (v) => str(v, 40).toLowerCase();
  function validPassword(v) {
    if (typeof v !== 'string' || v.length < 6 || v.length > 200) throw new HttpError(400, 'The password must be at least 6 characters');
    return v;
  }

  function canSee(me, otherId) {
    return me.id === otherId || me.isAdmin || !!stmt.sharesGroup.get(me.id, otherId);
  }

  function needAccount(me) {
    if (!me.username) throw new HttpError(403, 'Create an account first');
  }
  function needAdmin(me) {
    if (!me.isAdmin) throw new HttpError(403, 'Only an admin can do this');
  }

  /** Moves everything of an anonymous player into an account (logging in on a phone that was used before). */
  function mergeInto(oldId, newId) {
    db.prepare('INSERT OR IGNORE INTO members (group_id, player_id, joined_at) SELECT group_id, ?, joined_at FROM members WHERE player_id = ?').run(newId, oldId);
    db.prepare('DELETE FROM members WHERE player_id = ?').run(oldId);
    db.prepare('UPDATE OR IGNORE days SET player_id = ? WHERE player_id = ?').run(newId, oldId);
    db.prepare('DELETE FROM days WHERE player_id = ?').run(oldId);
    db.prepare('UPDATE attempts SET player_id = ? WHERE player_id = ?').run(newId, oldId);
    db.prepare('UPDATE challenges SET created_by = ? WHERE created_by = ?').run(newId, oldId);
    db.prepare('UPDATE groups SET created_by = ? WHERE created_by = ?').run(newId, oldId);
    db.prepare('DELETE FROM players WHERE id = ?').run(oldId);
  }

  /** Removes a player and everything they had (admin). */
  function removePlayer(playerId) {
    tx(() => {
      const groups = db.prepare('SELECT group_id AS id FROM members WHERE player_id = ?').all(playerId);
      db.prepare('DELETE FROM members WHERE player_id = ?').run(playerId);
      for (const g of groups) {
        const other = db.prepare('SELECT player_id AS id FROM members WHERE group_id = ? ORDER BY joined_at LIMIT 1').get(g.id);
        if (!other) db.prepare('DELETE FROM groups WHERE id = ?').run(g.id);
      }
      // Groups and challenges they started stay, handed to someone still in the group.
      for (const g of db.prepare('SELECT id FROM groups WHERE created_by = ?').all(playerId)) {
        const other = db.prepare('SELECT player_id AS id FROM members WHERE group_id = ? ORDER BY joined_at LIMIT 1').get(g.id);
        if (other) db.prepare('UPDATE groups SET created_by = ? WHERE id = ?').run(other.id, g.id);
        else db.prepare('DELETE FROM groups WHERE id = ?').run(g.id);
      }
      for (const c of db.prepare('SELECT id, group_id AS groupId FROM challenges WHERE created_by = ?').all(playerId)) {
        const other = db.prepare('SELECT player_id AS id FROM members WHERE group_id = ? ORDER BY joined_at LIMIT 1').get(c.groupId);
        if (other) db.prepare('UPDATE challenges SET created_by = ? WHERE id = ?').run(other.id, c.id);
        else db.prepare('DELETE FROM challenges WHERE id = ?').run(c.id);
      }
      db.prepare('INSERT OR IGNORE INTO removed_devices (id, removed_at) SELECT id, ? FROM devices WHERE player_id = ?').run(now(), playerId);
      for (const t of ['days', 'attempts', 'tracks', 'devices']) db.prepare(`DELETE FROM ${t} WHERE player_id = ?`).run(playerId);
      db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
    });
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
    ['GET', /^\/v1\/me$/, (me) => meInfo(me)],

    ['PUT', /^\/v1\/me$/, (me, _p, body) => {
      const name = str(body?.name, 30) || 'Skier';
      stmt.renamePlayer.run(name, me.id);
      return meInfo(me);
    }],

    // ----- accounts -----
    ['POST', /^\/v1\/account\/register$/, (me, _p, body) => {
      if (me.username) throw new HttpError(400, `This phone is already logged in as ${me.username}`);
      const username = cleanUsername(body?.username);
      if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Usernames are 3–20 letters, digits, dots, dashes or underscores');
      const pw = validPassword(body?.password);
      if (stmt.byUsername.get(username)) throw new HttpError(409, 'That username is taken');
      const name = str(body?.name, 30) || me.name;
      // The first account on a server runs it.
      const admin = stmt.anyAdmin.get() ? 0 : 1;
      stmt.register.run(username, hashPassword(pw), name, admin, me.id);
      return meInfo(me);
    }],

    ['POST', /^\/v1\/account\/login$/, (me, _p, body) => {
      const username = cleanUsername(body?.username);
      loginAllowed(username);
      const acct = username ? stmt.byUsername.get(username) : null;
      if (!acct || typeof body?.password !== 'string' || !checkPasswordHash(body.password, acct.pass_hash)) loginFailed(username);
      fails.clear(username);
      if (acct.id !== me.id) {
        tx(() => {
          stmt.moveDevice.run(acct.id, me.deviceId);
          // This phone was used without an account: its groups, days and times come along.
          if (!me.username && stmt.deviceCount.get(me.id).n === 0) mergeInto(me.id, acct.id);
        });
      }
      return meInfo({ id: acct.id });
    }],

    ['POST', /^\/v1\/account\/logout$/, (me) => {
      stmt.deleteDevice.run(me.deviceId);
      return { ok: true };
    }],

    ['PUT', /^\/v1\/account\/password$/, (me, _p, body) => {
      needAccount(me);
      const acct = stmt.player.get(me.id);
      if (typeof body?.old !== 'string' || !checkPasswordHash(body.old, acct.pass_hash)) throw new HttpError(401, 'Your current password is wrong', 'login');
      const hash = hashPassword(validPassword(body?.password));
      tx(() => {
        stmt.setPassword.run(hash, me.id);
        // Log out every other phone on this account; this one stays logged in.
        stmt.logOutOtherDevices.run(me.id, me.deviceId);
        stmt.deleteOtherDevices.run(me.id, me.deviceId);
      });
      return { ok: true };
    }],

    // ----- profile -----
    ['PUT', /^\/v1\/me\/avatar$/, (me, _p, body) => {
      const img = typeof body?.jpeg === 'string' ? body.jpeg : '';
      if (!img || img.length > MAX_AVATAR || !/^[A-Za-z0-9+/=]+$/.test(img)) throw new HttpError(400, 'Invalid picture');
      stmt.setAvatar.run(img, me.id);
      return { ok: true };
    }],

    ['DELETE', /^\/v1\/me\/avatar$/, (me) => {
      stmt.setAvatar.run(null, me.id);
      return { ok: true };
    }],

    ['PUT', /^\/v1\/me\/profile$/, (me, _p, body) => {
      const badges = (Array.isArray(body?.badges) ? body.badges : []).slice(0, 40)
        .filter((b) => b && typeof b.id === 'string')
        .map((b) => ({ id: str(b.id, 30), emoji: str(b.emoji, 8), title: str(b.title, 30), at: typeof b.at === 'number' ? b.at : null }));
      stmt.setProfile.run(JSON.stringify({ badges }), me.id);
      return { ok: true };
    }],

    ['GET', /^\/v1\/players\/([^/]+)$/, (me, [pid]) => {
      if (!canSee(me, pid)) throw new HttpError(404, 'Skier not found');
      const p = stmt.profile.get(pid);
      if (!p) throw new HttpError(404, 'Skier not found');
      const [from, to, key] = seasonStart(now());
      let badges = [];
      try { badges = JSON.parse(p.profile ?? '{}').badges ?? []; } catch { badges = []; }
      return {
        id: p.id, name: p.name, username: p.username, hasAvatar: !!p.hasAvatar, createdAt: p.createdAt,
        season: { key, ...stmt.totals.get(pid, from, to) },
        allTime: stmt.totals.get(pid, '0000-00-00', '9999-99-99'),
        recent: stmt.recentDays.all(pid),
        badges,
      };
    }],

    ['GET', /^\/v1\/players\/([^/]+)\/avatar$/, (me, [pid]) => {
      if (!canSee(me, pid)) throw new HttpError(404, 'Skier not found');
      return { jpeg: stmt.avatar.get(pid)?.avatar ?? null };
    }],

    // ----- online backup of days -----
    ['GET', /^\/v1\/me\/tracks$/, (me) => {
      needAccount(me);
      return stmt.tracks.all(me.id);
    }],

    ['PUT', /^\/v1\/me\/tracks\/([^/]+)$/, (me, [dayId], body) => {
      needAccount(me);
      id(dayId, 'day id');
      const data = typeof body?.data === 'string' ? body.data : '';
      if (!data || data.length > MAX_TRACK || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new HttpError(400, 'Invalid track');
      stmt.upsertTrack.run(
        me.id, dayId, num(body?.startedAt, 0, 1e14), typeof body?.endedAt === 'number' ? body.endedAt : null,
        str(body?.place, 80) || null, str(body?.sport, 20) || null, data, data.length, now(),
      );
      return { ok: true };
    }],

    ['GET', /^\/v1\/me\/tracks\/([^/]+)$/, (me, [dayId]) => {
      needAccount(me);
      const t = stmt.track.get(me.id, id(dayId, 'day id'));
      if (!t) throw new HttpError(404, 'No backup of that day');
      return t;
    }],

    ['DELETE', /^\/v1\/me\/tracks\/([^/]+)$/, (me, [dayId]) => {
      needAccount(me);
      stmt.deleteTrack.run(me.id, id(dayId, 'day id'));
      return { ok: true };
    }],

    // ----- admin -----
    ['GET', /^\/v1\/admin\/players$/, (me) => {
      needAdmin(me);
      return stmt.adminPlayers.all().map((p) => ({ ...p, isAdmin: !!p.isAdmin, hasAvatar: !!p.hasAvatar }));
    }],

    ['DELETE', /^\/v1\/admin\/players\/([^/]+)$/, (me, [pid]) => {
      needAdmin(me);
      if (pid === me.id) throw new HttpError(400, 'You can’t remove yourself');
      if (!stmt.player.get(pid)) throw new HttpError(404, 'Skier not found');
      removePlayer(pid);
      return { ok: true };
    }],

    ['PUT', /^\/v1\/admin\/players\/([^/]+)\/admin$/, (me, [pid], body) => {
      needAdmin(me);
      const p = stmt.player.get(pid);
      if (!p || !p.username) throw new HttpError(404, 'Only accounts can be admins');
      if (pid === me.id && !body?.isAdmin) throw new HttpError(400, 'You can’t take away your own admin rights');
      stmt.setAdmin.run(body?.isAdmin ? 1 : 0, pid);
      return { ok: true };
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
  function handle(method, url, headers, body, ip = '') {
    let u;
    try {
      u = new URL(url, 'http://x');
    } catch {
      throw new HttpError(400, 'Invalid address');
    }
    if (method === 'GET' && u.pathname === '/v1/health') {
      return [200, { ok: true, app: 'ski-tracker-friends', v: 2, accounts: true, password: !!passwordHash }];
    }
    for (const [m, re, fn] of routes) {
      if (m !== method) continue;
      const match = re.exec(u.pathname);
      if (!match) continue;
      // Behind Cloudflare Tunnel the socket is always cloudflared, so use the real client IP it passes on.
      let params;
      try {
        params = match.slice(1).map(decodeURIComponent);
      } catch {
        throw new HttpError(400, 'Invalid address'); // e.g. /v1/groups/%zz
      }
      const cred = credentials(headers.authorization);
      checkPassword(headers['x-server-password'], String(headers['cf-connecting-ip'] || ip), !!cred?.known);
      const me = auth(cred);
      return [200, fn(me, params, body, u.searchParams)];
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
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return; // the rest is read and thrown away
      size += c.length;
      if (size > MAX_BODY) {
        // Answer, then let the upload run out: cutting the connection here would
        // leave the app with a network error instead of this message.
        tooLarge = true;
        chunks.length = 0;
        res.writeHead(413, { 'content-type': 'application/json', connection: 'close' }).end(JSON.stringify({ error: 'Request too large' }));
      } else {
        chunks.push(c);
      }
    });
    req.on('error', () => undefined); // the client hung up halfway
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
        [status, out] = api.handle(req.method, req.url, req.headers, body, req.socket.remoteAddress);
      } catch (e) {
        status = e instanceof HttpError ? e.status : 500;
        out = { error: e instanceof HttpError ? e.message : 'Server error', ...(e?.code ? { code: e.code } : {}) };
        if (e?.code === 'password' || e?.code === 'login') delay = WRONG_PASSWORD_DELAY_MS;
        if (!(e instanceof HttpError)) log(e);
      }
      const send = () => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(out));
      if (delay) setTimeout(send, delay);
      else send();
    });
  };
}
