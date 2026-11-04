import { matchSession } from '../challenges/service';
import { createSession, finishSession, insertMotionEvents, insertPoints } from '../db';
import { simulateDay } from '../lib/sim';
import { computeStats } from '../lib/stats';

/** Adds a finished fake ski day to Days, so you can explore the app without snow. */
export async function addDemoDay(daysAgo = 1): Promise<string> {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(9, Math.floor(Math.random() * 40), 0, 0);
  const runs = 3 + Math.floor(Math.random() * 4);
  const base = 12 + Math.random() * 3;
  const tops = Array.from({ length: runs }, (_, i) => base + i * (1 + Math.random()));
  const sim = simulateDay({ start: d.getTime(), runs, seed: Math.floor(Math.random() * 1e6), runTopSpeeds: tops, turns: true });
  const id = await createSession(d.getTime(), true);
  await insertPoints(id, sim.points);
  await insertMotionEvents(id, sim.motion.map((e) => {
    const p = sim.points.find((q) => q.t >= e.t) ?? sim.points[sim.points.length - 1];
    return { ...e, lat: p.lat, lon: p.lon };
  }));
  const stats = computeStats(sim.points);
  await finishSession(id, sim.points[sim.points.length - 1].t, stats, 'Demo Mountain');
  await matchSession(id, sim.points);
  return id;
}
