/**
 * Jumps and falls from the phone's accelerometer.
 *
 * - Jump: the phone is in free fall (total acceleration close to 0 g) for a
 *   moment, followed by a landing bump. Airtime = the free-fall time.
 * - Fall: a hard impact (≥ 3 g) followed by lying still for a few seconds.
 *
 * Samples are in g (expo-sensors units), `t` in epoch ms. The detector only
 * looks at the size of the acceleration, so it works whichever way the phone
 * sits in your pocket.
 */

export type MotionKind = 'jump' | 'fall';

export interface MotionEvent {
  t: number;
  kind: MotionKind;
  /** Jump: airtime in seconds. Fall: peak impact in g. */
  value: number;
}

export interface AccelSample {
  t: number;
  x: number;
  y: number;
  z: number;
}

export const MOTION = {
  freeFallG: 0.35, // below this you're in the air
  freeFallExitG: 0.6, // above this the free fall is over
  minAir: 0.25, // s: shorter "free falls" are bumps
  maxAir: 3, // s: longer is the phone falling off a lift, not a jump
  landingG: 1.4, // a real landing gives at least this bump…
  landingWindowMs: 400, // …within this long after the free fall
  impactG: 3, // a fall starts with an impact at least this hard
  impactSettleMs: 1000, // ignore the tumble right after the impact
  stillTolG: 0.15, // "still" = within this of 1 g
  stillMs: 2500, // lying still this long after an impact = a fall
  stillSearchMs: 8000, // the stillness must start within this long after the impact
  fallCooldownMs: 15000, // one crash, one fall
  maxGapMs: 300, // a gap in samples (app paused) resets the detector
};

const G = 9.81;

/** How high you went on a jump, from its airtime (ballistic flight: h = g·t²/8). */
export function jumpHeight(airtime: number): number {
  return (G * airtime * airtime) / 8;
}

export class MotionDetector {
  private lastT: number | null = null;
  private airStart: number | null = null;
  private landing: { start: number; end: number; peak: number } | null = null;
  private impact: { t: number; peak: number; stillSince: number | null } | null = null;
  private lastFallAt = -Infinity;

  reset() {
    this.lastT = null;
    this.airStart = null;
    this.landing = null;
    this.impact = null;
  }

  /** Feed one sample; returns any jump or fall it completes. */
  push(s: AccelSample): MotionEvent[] {
    if (this.lastT != null && (s.t - this.lastT > MOTION.maxGapMs || s.t < this.lastT)) this.reset();
    this.lastT = s.t;
    const g = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    if (!Number.isFinite(g)) return [];
    const out: MotionEvent[] = [];

    // ----- jumps -----
    if (this.landing) {
      this.landing.peak = Math.max(this.landing.peak, g);
      if (s.t - this.landing.end >= MOTION.landingWindowMs) {
        if (this.landing.peak >= MOTION.landingG) {
          out.push({ t: this.landing.start, kind: 'jump', value: (this.landing.end - this.landing.start) / 1000 });
        }
        this.landing = null;
      }
    }
    if (this.airStart == null) {
      if (g < MOTION.freeFallG && !this.landing) this.airStart = s.t;
    } else if (g >= MOTION.freeFallExitG) {
      const air = (s.t - this.airStart) / 1000;
      if (air >= MOTION.minAir && air <= MOTION.maxAir) this.landing = { start: this.airStart, end: s.t, peak: g };
      this.airStart = null;
    } else if (s.t - this.airStart > MOTION.maxAir * 1000) {
      this.airStart = null;
    }

    // ----- falls -----
    if (g >= MOTION.impactG && s.t - this.lastFallAt > MOTION.fallCooldownMs) {
      if (!this.impact || s.t - this.impact.t > MOTION.impactSettleMs) this.impact = { t: s.t, peak: g, stillSince: null };
      else this.impact.peak = Math.max(this.impact.peak, g);
    } else if (this.impact) {
      const since = s.t - this.impact.t;
      if (since >= MOTION.impactSettleMs) {
        if (Math.abs(g - 1) <= MOTION.stillTolG) {
          this.impact.stillSince ??= s.t;
          if (s.t - this.impact.stillSince >= MOTION.stillMs) {
            out.push({ t: this.impact.t, kind: 'fall', value: this.impact.peak });
            this.lastFallAt = this.impact.t;
            this.impact = null;
          }
        } else {
          this.impact.stillSince = null;
          if (since > MOTION.impactSettleMs + MOTION.stillSearchMs) this.impact = null;
        }
      }
    }
    return out;
  }
}

export interface MotionSummary {
  jumps: number;
  /** Longest airtime (s). */
  bestAir: number;
  /** All airtime added up (s). */
  totalAir: number;
  falls: number;
}

export const EMPTY_MOTION: MotionSummary = { jumps: 0, bestAir: 0, totalAir: 0, falls: 0 };

export function summariseMotion(events: Pick<MotionEvent, 'kind' | 'value'>[]): MotionSummary {
  const out = { ...EMPTY_MOTION };
  for (const e of events) {
    if (e.kind === 'jump') {
      out.jumps++;
      out.totalAir += e.value;
      out.bestAir = Math.max(out.bestAir, e.value);
    } else if (e.kind === 'fall') {
      out.falls++;
    }
  }
  return out;
}

/** Events that happened during [from, to] (epoch ms), with a little slack for the run's trimmed edges. */
export function eventsBetween<T extends { t: number }>(events: T[], from: number, to: number, slackMs = 5000): T[] {
  return events.filter((e) => e.t >= from - slackMs && e.t <= to + slackMs);
}
