/**
 * @jest-environment node
 */
// Write transactions on the phone's database run one after another. The fake database
// behaves like SQLite: a BEGIN inside an open transaction fails, and ROLLBACK undoes it all.
const mockLog: string[] = [];
let mockOpen = false;
let mockPending: string[] = [];
const mockTick = () => new Promise((r) => setTimeout(r, 1));

jest.mock('expo-sqlite', () => {
  const exec = async (sql: string) => {
    await mockTick();
    if (sql === 'BEGIN') {
      if (mockOpen) throw new Error('cannot start a transaction within a transaction');
      mockOpen = true;
      mockPending = [];
    } else if (sql === 'COMMIT') {
      mockOpen = false;
      mockLog.push(...mockPending);
    } else if (sql === 'ROLLBACK') {
      mockOpen = false;
      mockPending = [];
    }
  };
  const write = async (what: string) => {
    await mockTick();
    if (mockOpen) mockPending.push(what);
    else mockLog.push(what);
    return { changes: 1 };
  };
  const db = {
    getFirstSync: () => ({ user_version: 999 }),
    execSync: () => undefined,
    execAsync: exec,
    runAsync: (sql: string) => write(sql.includes('motion_events') ? 'motion' : 'other'),
    prepareAsync: async () => ({ executeAsync: () => write('point'), finalizeAsync: async () => undefined }),
    async withTransactionAsync(task: () => Promise<void>) {
      try {
        await exec('BEGIN');
        await task();
        await exec('COMMIT');
      } catch (e) {
        await exec('ROLLBACK').catch(() => undefined);
        throw e;
      }
    },
  };
  return { openDatabaseSync: () => db };
});

// eslint-disable-next-line import/first
import { insertMotionEvents, insertPoints } from '../src/db';

const pt = (t: number) => ({ t, lat: 47, lon: 10, alt: 2000, acc: 5, spd: 3 });

it('a jump saved while GPS fixes are being written loses neither', async () => {
  const results = await Promise.allSettled([
    insertPoints('s', [pt(1), pt(2), pt(3)]),
    insertMotionEvents('s', [{ t: 2, kind: 'jump', value: 0.4, lat: 47, lon: 10 }]),
    insertPoints('s', [pt(4), pt(5)]),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
  expect(mockLog.filter((x) => x === 'point')).toHaveLength(5);
  expect(mockLog.filter((x) => x === 'motion')).toHaveLength(1);
});
