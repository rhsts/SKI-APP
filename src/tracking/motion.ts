import { Accelerometer } from 'expo-sensors';
import { MotionDetector, type MotionEvent } from '../lib/motion';

/**
 * Feeds the accelerometer into the jump/fall detector while recording.
 * Android and iOS pause sensors while the app is in the background, so this
 * only sees motion while the app is open on screen.
 */

const RATE_MS = 20; // 50 samples a second: enough to time a 0.25 s free fall

let sub: { remove: () => void } | null = null;
const detector = new MotionDetector();
let offset: number | null = null;

export async function startMotion(onEvent: (e: MotionEvent) => void): Promise<boolean> {
  if (sub) return true;
  const ok = await Accelerometer.isAvailableAsync().catch(() => false);
  if (!ok) return false;
  detector.reset();
  offset = null;
  Accelerometer.setUpdateInterval(RATE_MS);
  sub = Accelerometer.addListener((m) => {
    // Sensor timestamps are precise but not wall-clock time: map them to epoch ms once
    // (and again if they drift), so batched events keep their real spacing.
    const now = Date.now();
    const sensorMs = Number.isFinite(m.timestamp) ? m.timestamp * 1000 : now;
    if (offset == null || Math.abs(sensorMs + offset - now) > 2000) offset = now - sensorMs;
    for (const e of detector.push({ t: Math.round(sensorMs + offset), x: m.x, y: m.y, z: m.z })) onEvent(e);
  });
  return true;
}

export function stopMotion(): void {
  sub?.remove();
  sub = null;
  detector.reset();
}
