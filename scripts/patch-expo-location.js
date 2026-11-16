// Runs after npm install. expo-location/next posts the tracking notification on a channel
// with IMPORTANCE_LOW, and Android hides such "silent" notifications from the lock screen by
// default, so the day's stats never showed there. This moves it to a new channel with default
// importance but no sound or vibration, and alerts only once (not on every refresh).
// A new channel id is needed: Android never raises the importance of an existing channel.
// Fails the install if expo-location changed, so the patch can't silently stop applying.
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '../node_modules/expo-location/android/src/main/java/expo/modules/location/next/locationForegroundService/ServiceNotification.kt',
);
const MARK = '// ski-tracker: lock screen patch';

let src = fs.readFileSync(file, 'utf8');
if (src.includes(MARK)) process.exit(0);

const edits = [
  ['"expo.location.next.notification.channel"', '"ski.tracking.v2" ' + MARK],
  [
    '.Builder(NOTIFICATION_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)',
    '.Builder(NOTIFICATION_CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)\n    .setSound(null, null)\n    .setVibrationEnabled(false)',
  ],
  ['.setOngoing(true)', '.setOngoing(true)\n    .setOnlyAlertOnce(true)'],
];
for (const [from, to] of edits) {
  if (!src.includes(from)) throw new Error(`patch-expo-location: "${from}" not found in ${file}`);
  src = src.replace(from, to);
}
fs.writeFileSync(file, src);
console.log('patch-expo-location: tracking notification moved to a lock-screen-visible channel');
