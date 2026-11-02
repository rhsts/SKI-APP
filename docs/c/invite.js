/*
 * Ski Tracker invite page logic. Plain JS (no build step) so GitHub Pages can serve it as-is.
 * decodeChallenge() mirrors src/lib/share.ts; __tests__/invite-page.test.ts keeps the two in sync.
 */
(function (root) {
  'use strict';

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var GHOST_SAMPLES = 20;
  var MAX_RESULTS = 10;
  var ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
  var BROKEN = 'This invite link is broken or incomplete.';

  function fromBase64Url(s) {
    var bytes = [], buf = 0, bits = 0;
    for (var k = 0; k < s.length; k++) {
      var v = B64.indexOf(s[k]);
      if (v < 0) throw new Error('bad base64');
      buf = ((buf << 6) | v) & 0xffffff;
      bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
    }
    var out = '';
    for (var i = 0; i < bytes.length;) {
      var b = bytes[i++], c;
      if (b < 0x80) c = b;
      else if (b < 0xe0) c = ((b & 31) << 6) | (bytes[i++] & 63);
      else if (b < 0xf0) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      out += String.fromCodePoint(c);
    }
    return out;
  }

  function decodeInts(str) {
    var out = [], i = 0, prev = 0;
    while (i < str.length) {
      var shift = 0, result = 0, b;
      do {
        if (i >= str.length) throw new Error('truncated');
        b = str.charCodeAt(i++) - 63;
        if (b < 0 || b > 63) throw new Error('bad char');
        result |= (b & 0x1f) << shift;
        shift += 5;
        if (shift > 30) throw new Error('overflow');
      } while (b >= 0x20);
      prev += result & 1 ? ~(result >> 1) : result >> 1;
      out.push(prev);
    }
    return out;
  }

  function cleanName(v, fallback) {
    if (typeof v !== 'string') return fallback;
    // eslint-disable-next-line no-control-regex
    var s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 30);
    return s || fallback;
  }

  /** Same result as decodeChallenge() in src/lib/share.ts (minus app-only fields). */
  function decodeChallenge(code) {
    var w;
    try { w = JSON.parse(fromBase64Url(String(code).trim())); } catch (e) { throw new Error(BROKEN); }
    if (!w || typeof w !== 'object') throw new Error(BROKEN);
    if (w.v !== 1) throw new Error('This invite was made with a newer version of the app. Please update.');
    if (typeof w.id !== 'string' || !ID_RE.test(w.id) || typeof w.p !== 'string') throw new Error(BROKEN);
    var parts = w.p.split(','), lats, lons, alts = null;
    try {
      lats = decodeInts(parts[0] || '');
      lons = decodeInts(parts[1] || '');
      if (typeof w.a === 'string') alts = decodeInts(w.a);
    } catch (e) { throw new Error(BROKEN); }
    if (lats.length < 2 || lats.length !== lons.length || lats.length > 500 || (alts && alts.length !== lats.length)) {
      throw new Error(BROKEN);
    }
    var path = lats.map(function (v, i) { return [v / 1e5, lons[i] / 1e5, alts ? alts[i] : null]; });
    if (path.some(function (p) { return Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180; })) throw new Error(BROKEN);

    var best = {};
    (Array.isArray(w.l) ? w.l.slice(0, MAX_RESULTS) : []).forEach(function (r) {
      if (!r || typeof r.i !== 'string' || !ID_RE.test(r.i)) return;
      if (typeof r.t !== 'number' || r.t <= 0 || r.t > 36000 || typeof r.d !== 'number' || r.d <= 0) return;
      var a = { playerId: r.i, playerName: cleanName(r.n, 'Skier'), time: r.t / 10, at: r.d * 1000 };
      if (!best[r.i] || a.time < best[r.i].time) best[r.i] = a;
    });
    var board = Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return a.time - b.time || a.at - b.at; });

    return {
      segment: { id: w.id, name: cleanName(w.n, 'Challenge'), creatorName: w.c == null ? null : cleanName(w.c, 'A friend'), path: path },
      leaderboard: board,
      fromName: w.f == null ? null : cleanName(w.f, 'A friend'),
    };
  }

  function lengthOf(path) {
    var R = 6371008.8, rad = Math.PI / 180, d = 0;
    for (var i = 1; i < path.length; i++) {
      var dLat = (path[i][0] - path[i - 1][0]) * rad, dLon = (path[i][1] - path[i - 1][1]) * rad;
      var s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(path[i - 1][0] * rad) * Math.cos(path[i][0] * rad) * Math.pow(Math.sin(dLon / 2), 2);
      d += 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    }
    return d;
  }

  function fmtRaceTime(seconds) {
    var tenths = Math.round(seconds * 10), s = Math.floor(tenths / 10), d = tenths % 10;
    if (s < 60) return s + '.' + d + 's';
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    return (h > 0 ? h + ':' : '') + mm + ':' + String(r).padStart(2, '0') + '.' + d;
  }

  /** Reads the code from #d=… (preferred: never sent to the server) or ?d=… */
  function codeFromLocation(loc) {
    var m = (loc.hash || '').match(/[#&]d=([A-Za-z0-9_-]+)/) || (loc.search || '').match(/[?&]d=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  var api = { decodeChallenge: decodeChallenge, fmtRaceTime: fmtRaceTime, lengthOf: lengthOf, codeFromLocation: codeFromLocation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SkiInvite = api;
})(typeof self !== 'undefined' ? self : this);
