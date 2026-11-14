import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApi, listener } from './src/app.js';
import { openDb } from './src/db.js';

const PORT = Number(process.env.PORT || 8787);
const DB_FILE = process.env.DB_FILE || './data/ski-friends.db';
const PASSWORD = (process.env.SERVER_PASSWORD || '').trim();

mkdirSync(dirname(DB_FILE), { recursive: true });
const db = openDb(DB_FILE);
const server = createServer(listener(createApi(db, { password: PASSWORD }), (e) => console.error(e)));
// A phone on bad signal can take a while to send a day, but a connection that sends nothing
// (or never finishes) mustn't keep the Pi busy for ever.
server.headersTimeout = 20 * 1000;
server.requestTimeout = 3 * 60 * 1000;
server.listen(PORT, () => {
  console.log(`Ski Tracker friends server on port ${PORT}, data in ${DB_FILE}`);
  if (PASSWORD) console.log('Server password is on: the app needs it to connect.');
  else console.warn('WARNING: no SERVER_PASSWORD set, so anyone who knows the address can use this server.');
});

const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
