# Ski Tracker

A ski-day tracker for Android and iOS built with Expo / React Native. Start recording at the lift, put
the phone in your pocket, and the app logs your day:

- **Top speed**, average ski speed, and current speed while you ride
- **Vertical** (height skied down / ridden up), peak and lowest altitude
- **Runs vs lifts**: each run and each lift ride is detected automatically, with its own speed,
  vertical, distance and duration
- **Where**: the resort or village name is looked up automatically, and you can rename it
- **Map with replay**: your route on a terrain map, runs coloured by speed, lifts dashed. Press play
  (or drag) to replay the day with the elevation profile
- **Season totals and personal records**: days, runs, vertical, distance, time on the snow; fastest speed,
  longest run, biggest day
- Works offline. Everything is stored on the phone (SQLite).

> **Coming next (phase 2): challenges.** Mark a stretch of a run as a segment, get timed automatically
> every time you ski it, chase your personal best against a live "ghost", and invite friends to beat your
> time. The database already has `segments` and `attempts` tables for this.

## Try it on your phone (Android, no build needed)

1. Install **Expo Go** from the Play Store.
2. On your computer (Node 20+):
   ```bash
   npm install
   ```
   ```bash
   npx expo start
   ```
3. Scan the QR code with Expo Go.

No snow? Go to **Profile → Simulated GPS** and press **Start day**: a fake ski day plays at 20× speed.
You can also tap **Add a demo day** to get a finished day you can explore in Days and Season.

### Background tracking

- **Android**: allow location **"All the time"** when asked. The app then records with the screen off and
  shows a "Tracking your ski day" notification. If you only allow "While using the app", recording still
  works, but the app keeps the screen on and must stay open.
- **iPhone in Expo Go**: Expo Go can't track in the background, so keep the app open. A development build
  (below) tracks with the phone locked.

### Development build (full background tracking, your own app icon)

```bash
npx eas-cli@latest build --profile development --platform android
```

Or, with Android Studio installed:

```bash
npx expo run:android
```

For a standalone Android build, Google Maps needs an API key in `app.json` →
`expo.android.config.googleMaps.apiKey`. Expo Go already includes one.

## How the numbers are calculated

All the logic is in `src/lib/stats.ts` and is covered by unit tests.

| What | How |
|---|---|
| GPS clean-up | Drops fixes with > 40 m accuracy, duplicate timestamps, and jumps faster than 162 km/h |
| Speed | GPS Doppler speed (or distance over ≥ 3 s), then a 3-point median, so one bad fix can't set a top speed |
| Vertical | Altitude smoothed over 5 fixes, with 4 m hysteresis so GPS altitude noise doesn't add up |
| Runs / lifts | The altitude trend has to reverse by 25 m to start a new leg. Descents are runs. Climbs are lifts if they rise ≥ 0.5 m/s, move ≤ 8 m/s, and go mostly straight. Anything else (hiking, breaks) is "other" |
| Ski time | The sum of all runs. Standing still at the top or bottom of a run isn't counted |

## Project layout

```
src/app/           screens (Expo Router): Record, Days, Season, Profile, day/[id]
src/lib/           pure TypeScript: geo maths, stats, season, formatting, simulator
src/tracking/      background GPS task, recording state, place lookup, demo days
src/db/            SQLite schema and queries
src/components/    map, elevation chart, stat tiles, timeline cards
__tests__/         Jest tests for the logic
```

## Scripts

```bash
npm test
```

```bash
npm run typecheck
```
