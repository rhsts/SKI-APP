# Changelog

## Unreleased

### Changed
- **SOS no longer has call buttons.** The screen shows the emergency number to dial yourself, your
  coordinates, the nearest piste or lift, and Copy and Send location.

## 1.1 (2026-11-27)

### Before you install: a one-time reinstall

From 1.1 on, the APK is signed with Ski Tracker's own release key instead of the public debug key. Android
won't install it over an older build, so this one time:

1. On the old app, tap **You → Back up all days** and keep the file somewhere off the phone.
2. Uninstall Ski Tracker.
3. Install the 1.1 APK.
4. Tap **You → Restore from a backup**. Days already in your account's online backup come back when you log in again.

Updates after this install over the previous version as before.

### New
- **Friends is a live map.** The Friends tab opens on a map of the friends who are on the mountain right
  now, with meet-up pins. Leaderboards moved to their own screen (Friends → Leaderboards).

### Changed
- **One design across the app.** Every screen now uses the same colours, type, spacing and corner radii.
  Labels are sentence case, and the accent colour is kept for what is live, selected or the main action.

### Fixed
- GPS fixes with impossible times (a stale first fix, or one stamped in the future) are no longer saved,
  so a day's time and distance aren't inflated and the Record screen keeps updating.
- Live stats no longer slow the app down on very long days.
- After the app was killed mid-day, reattaching restarts the barometer.
- Finish no longer hangs on weak signal: the place lookup gives up after 8 seconds.
- Launch is fast again with a long history after an update.
- Friends sync no longer stops for good when the server refuses one day or challenge time.
- When a group's owner leaves, the longest-standing member becomes the owner.

### Security
- Release APKs are signed with our own key, and the build refuses to publish one signed with the debug key.
- Wrong group codes are rate limited, and each one is delayed by a second.
- The friends server can name its admin with `ADMIN_USERNAME` instead of "whoever registers first".
- Plain `http://` server addresses are only accepted on a home network or Tailscale.
- The `cloudflared` image is pinned to a fixed version.
