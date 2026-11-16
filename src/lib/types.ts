import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

/** The name of an icon in the one icon set the app draws with. */
export type IconName = ComponentProps<typeof Ionicons>['name'];

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

/** run = skiing down, lift = riding up, tour = climbing under your own power (skinning/hiking), other = breaks. */
export type ActivityKind = 'run' | 'lift' | 'tour' | 'other';

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
  /** Lifts only: seconds spent in the lift line before boarding. */
  wait?: number;
  /** Runs only: turns counted from the GPS track, and the strongest turn in g. */
  turns?: number;
  maxG?: number;
  /** Runs only: times you stood still partway down (waiting for friends, a rest), and for how long in total (s). */
  stops?: number;
  stopTime?: number;
}

export interface DayStats {
  duration: number; // s, first to last fix
  movingTime: number; // s, while moving > 1 m/s
  skiTime: number; // s, sum of runs
  liftTime: number; // s, sum of lifts
  /** s spent waiting in lift lines (absent on days saved by older versions). */
  liftWaitTime?: number;
  /** Ski touring: time and height climbed under your own power. */
  tourTime?: number;
  tourVertical?: number;
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
  /** Turns over all runs, and the strongest turn of the day in g (absent on days saved by older versions). */
  turns?: number;
  maxG?: number;
  activities: Activity[];
  /** Detection logic version these stats were computed with (absent = before versioning). See STATS_VERSION. */
  statsVersion?: number;
}

export type Units = 'metric' | 'imperial';
