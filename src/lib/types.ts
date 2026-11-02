/** One GPS fix. `t` is epoch milliseconds, `alt` metres, `acc` horizontal accuracy (m), `spd` m/s. */
export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  alt: number | null;
  acc: number | null;
  spd: number | null;
  /** Air pressure in hPa from the phone's barometer, when it has one. */
  pres?: number | null;
}

export type ActivityKind = 'run' | 'lift' | 'other';

export interface Activity {
  kind: ActivityKind;
  /** Indices into the cleaned track. */
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  duration: number; // s
  distance: number; // m
  verticalDown: number; // m
  verticalUp: number; // m
  topSpeed: number; // m/s
  avgSpeed: number; // m/s
}

export interface DayStats {
  duration: number; // s, first to last fix
  movingTime: number; // s, while moving > 1 m/s
  skiTime: number; // s, sum of runs
  liftTime: number; // s, sum of lifts
  distance: number; // m, everything
  skiDistance: number; // m, runs only
  topSpeed: number; // m/s
  topSpeedTime: number | null; // epoch ms
  avgSkiSpeed: number; // m/s over runs
  verticalDown: number; // m
  verticalUp: number; // m
  maxAlt: number | null;
  minAlt: number | null;
  runCount: number;
  liftCount: number;
  longestRun: number; // m
  activities: Activity[];
}

export type Units = 'metric' | 'imperial';
