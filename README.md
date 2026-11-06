# Ski Tracker

A ski-day tracker for Android and iOS built with Expo / React Native. Start recording at the lift, put
the phone in your pocket, and the app logs your day:

- **Top speed**, average ski speed, and current speed while you ride
- **Vertical** (height skied down / ridden up), peak and lowest altitude. Uses the phone's **barometer**
  when it has one, which is far steadier than GPS altitude
- **Runs vs lifts**: each run and each lift ride is detected automatically, with its own speed,
  vertical, distance and duration. A **"Run done" card** and a buzz when you finish a run, and a flash
  when you set a new top speed
- **Run names**: each run is matched to the OpenStreetMap piste it followed (name and difficulty colour)
- **Where**: the resort or village name is looked up automatically, and you can rename it
- **Map with replay**: your route on a terrain map, runs coloured by speed, lifts dashed. Drag on the
  elevation graph (or press play) to replay the day
- **Battery saver**: GPS slows down on lifts and breaks, and the Record screen shows how many hours of
  tracking are left. The Android notification shows live runs, vertical and top speed
- **Season**: totals, personal records, **goals** (weekly vertical, season top speed, ski days) and **badges**
- **Share & export**: share a day as an image, export GPX (Strava, Komoot, Google Earth), compare two days,
  and back up / restore everything
- **Challenges with friends**: turn any run into a challenge, send a link, race each other's ghosts,
  see split times, and run group challenges with up to 20 skiers
- **Dark mode** (follows the phone) and big gloves-friendly record buttons
- **Piste breakdown**: time and vertical on green/blue/red/black per day, season and all time
- **Lifts**: each ride named after its lift, plus time spent in **lift lines**
- **Run detail**: per-run map, speed and elevation charts, average slope and steepest part
- **Sport type** (ski, snowboard, telemark, sit-ski, ski touring) and **ski touring** climbs detected
- **All-time** totals and records next to each season
- **Offline trail map**: pistes and lifts downloaded to the phone, drawn on your map and on a live map
- **Snow & weather**: temperature, wind, fresh snow, snow depth and a 3-day outlook at your altitude
- **Photos** pinned on the map where you took them
- **SOS**: one-tap emergency call, your coordinates, nearest piste/lift and send-location
- **Auto-pause** during long breaks and **reminders to start** when you arrive at a ski area you know
- **Import** ski days from **Slopes** (.slopes files) and GPX from other apps (Ski Tracks, Strava, watches)
- **Turns**: turns per run and per day, and your strongest turn in g, from the GPS track
- **Jumps and falls** from the motion sensor (while the app is open on screen): airtime and height per jump,
  falls per run, and an **"Are you OK?"** check after a hard fall that opens SOS if you don't answer
- **Private app**: it only opens for people who know your friends server's address and password (a lock screen
  on first start, which locks again if you change the password)
- **Accounts** on your friends server: log in on any phone, **online backup** of your days, a **profile** with
  picture, season totals and badges for friends, and **Manage people** for the admin
- **Friend groups** (needs the friends server in [`server/`](server/README.md), e.g. on a Raspberry Pi): a group
  per ski trip with a **daily leaderboard** (vertical, top speed, runs) and **group challenges**: everyone who
  skis the stretch on that day is timed automatically and ranked
- **Streaks** (days and weeks in a row) and **3 weekly challenges** every Monday, with targets based on your own days
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

### Invite links and the web page

Invites are normal web links, such as `https://rhsts.github.io/SKI-APP/c/#d=…`, so they're tappable in every
messenger. The page (`docs/c/`) shows who challenged you, the route, the time to beat and the leaderboard,
and has an **Open in Ski Tracker** button. The challenge data is in the part after `#`, which browsers never
send to the server.

If the app doesn't open (for example while testing in Expo Go), tap **Copy invite** on the page, then
**Challenges → Paste invite from a friend** in the app.

**One-time setup (GitHub Pages):**
1. GitHub → the repo → **Settings → General → Danger Zone → Change visibility → Public**.
2. **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, then choose the branch
   with this code and the **`/docs`** folder → **Save**.
3. After about a minute, https://rhsts.github.io/SKI-APP/ shows the Ski Tracker page.

To host the page somewhere else, change `INVITE_PAGE_URL` in `src/config.ts`.

## Install the app (Android)

Every push builds an installable APK on GitHub Actions and attaches it to a **Release**.

1. On your phone, open **https://github.com/rhsts/SKI-APP/releases** and tap the newest release.
2. Tap `ski-tracker-<n>.apk` to download it. When asked, allow your browser to **install unknown apps**,
   then tap **Install**.
3. On first launch, allow location **"All the time"** (for tracking with the screen off and start reminders)
   and notifications.

New builds install over the old one and keep your data. To build manually: **Actions → Build Android APK →
Run workflow**.

### Google Maps key (needed for maps in the installed app)

The installed Android app uses Google Maps, which needs a free API key. Without one, maps show a placeholder
and everything else still works.

1. Go to **console.cloud.google.com** → create a project (any name).
2. **APIs & Services → Library** → search **Maps SDK for Android** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
4. Recommended: edit the key → **Application restrictions: Android apps** → add package `com.rhsts.skiapp`
   (fingerprint optional) → **API restrictions: Maps SDK for Android** → Save.
5. In GitHub: repo **Settings → Secrets and variables → Actions → New repository secret**, name
   `GOOGLE_MAPS_API_KEY`, paste the key → **Add secret**.
6. **Actions → Build Android APK → Run workflow**, then install the new release.

The build is signed with the standard React Native debug key: fine for installing on your own phones, but the
Play Store would need a real signing key.

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
