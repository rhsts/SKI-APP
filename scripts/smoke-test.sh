#!/usr/bin/env bash
# Installs the APK on the emulator, starts the app and checks it is still running
# after 30 seconds. Prints any crash (Java or JavaScript) into the job log.
set -u
APK="$1"
PKG=com.rhsts.skiapp
mkdir -p smoke

adb wait-for-device
adb install -r -g "$APK" || { echo "::error::Install failed"; exit 1; }
# Background location must be granted separately on Android 10+.
adb shell pm grant $PKG android.permission.ACCESS_BACKGROUND_LOCATION 2>/dev/null || true
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS 2>/dev/null || true

adb logcat -c
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 30

adb logcat -d -v time > smoke/logcat.txt
adb exec-out screencap -p > smoke/screen.png || true

echo "===== Crash / error lines ====="
grep -n -A 40 "FATAL EXCEPTION" smoke/logcat.txt | head -150 || true
grep -n -E "ReactNativeJS|E/ReactNative|E/unknown:React|SoLoader|UnsatisfiedLink|Error: |TypeError|Invariant Violation" smoke/logcat.txt | grep -v -i "anr" | head -60 || true
echo "==============================="

if adb shell pidof $PKG >/dev/null; then
  echo "✅ App is running after 30 s"
  grep -E "ReactNativeJS" smoke/logcat.txt | tail -20 || true
  exit 0
else
  echo "::error::App is not running after 30 s (it crashed or closed)"
  exit 1
fi
