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
- **Challenges with friends**: turn any run into a challenge, send a link, and race each other's times
- Works offline. Everything is stored on the phone (SQLite).

## Challenges

1. Open a ski day in **Days** and tap the 🏳 flag on a run. Drag the start and finish to the stretch you
   want to race, give it a name, and save. The app finds your time on it from every day you've recorded.
2. Tap **Challenge a friend** to send an invite link (WhatsApp, Messages, …). The link contains the course
   and the leaderboard, so there's no account or server.
3. Your friend opens the link and taps **Accept challenge**. Next time either of you records a day and skis
   through the start and finish, you're **timed automatically**. While you ski it, the Record screen shows a
   live timer and how far ahead (green) or behind (red) you are versus the leader's **ghost**.
4. Tap **Send my time back** to share your result. Opening the reply updates the other person's leaderboard.
   Sending the same result twice never creates duplicates.

How timing works: the clock starts when you leave the 30 m start circle and stops when you enter the 30 m
finish circle, measured to 0.1 s between GPS fixes. You have to follow the course (stray more than 60 m off
the line and the attempt is dropped), and you can't take a shortcut to the finish.

**If a link doesn't open the app**, copy the whole message and tap **Paste invite** at the top of the
Challenges tab. This always works. Some messengers don't make custom app links (`skiapp://…`) clickable,
and in Expo Go links only work for phones on the same Wi-Fi as the computer running `npx expo start`.

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
| Challenge time | `src/lib/segments.ts`: gate crossings interpolated between fixes, course-following check, a 21-point ghost for live comparison |
| Invite links | `src/lib/share.ts`: course and best times packed into a compact URL-safe code (~2–4 KB), strictly validated when opened |

## Project layout

```
src/app/           screens (Expo Router): Record, Days, Challenges, Season, Profile, day/[id], segment/*, c (invite)
src/lib/           pure TypeScript: geo maths, stats, season, formatting, simulator
src/tracking/      background GPS task, recording state + live challenge timing, place lookup, demo days
src/challenges/    create, time, import and share challenges
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
