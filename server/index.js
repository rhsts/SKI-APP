import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApi, listener } from './src/app.js';
import { openDb } from './src/db.js';

const PORT = Number(process.env.PORT || 8787);
const DB_FILE = process.env.DB_FILE || './data/ski-friends.db';

mkdirSync(dirname(DB_FILE), { recursive: true });
const db = openDb(DB_FILE);
const server = createServer(listener(createApi(db), (e) => console.error(e)));
server.listen(PORT, () => console.log(`Ski Tracker friends server on port ${PORT}, data in ${DB_FILE}`));

const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
