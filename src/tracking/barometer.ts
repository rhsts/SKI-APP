import { Barometer } from 'expo-sensors';

/**
 * Latest air pressure from the phone's barometer (hPa), or null if the phone
 * has none. While recording, a listener keeps a fresh value; if it's stale
 * (e.g. the app was woken in the background) we take a one-off reading.
 */

let available: boolean | null = null;
let latest: { hPa: number; at: number } | null = null;
let sub: { remove: () => void } | null = null;

async function isAvailable(): Promise<boolean> {
  if (available == null) available = await Barometer.isAvailableAsync().catch(() => false);
  return available;
}

export async function startBarometer(): Promise<void> {
  if (sub || !(await isAvailable())) return;
  Barometer.setUpdateInterval(1000);
  sub = Barometer.addListener((m) => {
    if (Number.isFinite(m.pressure)) latest = { hPa: m.pressure, at: Date.now() };
  });
}

export function stopBarometer(): void {
  sub?.remove();
  sub = null;
}

export async function readPressure(timeoutMs = 400): Promise<number | null> {
  if (latest && Date.now() - latest.at < 3000) return latest.hPa;
  if (!(await isAvailable())) return null;
  return new Promise((resolve) => {
    let done = false;
    const once = Barometer.addListener((m) => {
      if (done) return;
      done = true;
      once.remove();
      latest = { hPa: m.pressure, at: Date.now() };
      resolve(Number.isFinite(m.pressure) ? m.pressure : null);
    });
    setTimeout(() => {
      if (done) return;
      done = true;
      once.remove();
      resolve(null);
    }, timeoutMs);
  });
}
