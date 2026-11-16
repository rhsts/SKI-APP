// Registers the background GPS task before anything else, so Android can deliver
// locations to it even when it starts the app headless with the screen off.
import '../tracking/task';
// Same for the task that looks up piste names while the app is closed.
import { registerPistesTask } from '../mountain/pistes-task';

import { Inter_300Light } from '@expo-google-fonts/inter/300Light';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { useFonts } from 'expo-font';
import Stack from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { getDb, listSessions } from '../db';
import { lookupStalePistes } from '../mountain/pistes';
import { getSettings, initSettings, useSettings } from '../settings';
import { DialogHost } from '../components/DialogHost';
import { LockScreen } from '../components/LockScreen';
import { Setup } from '../components/Setup';
import { checkServer } from '../friends/api';
import { font, size, useTheme } from '../theme';
// Importing this also registers the ski-area reminder (geofence) task.
import { setupNotifications } from '../tracking/geofence';
import { recoverActiveDay } from '../tracking/tracker';
import { syncFriends } from '../friends/sync';

setupNotifications();

export default function RootLayout() {
  const { colors, dark } = useTheme();
  const [ready, setReady] = useState(false);
  // If a font fails to load the app still opens, in the system font.
  const [fontsLoaded, fontsFailed] = useFonts({ Inter_300Light, Inter_400Regular, Inter_500Medium });
  const fontsDone = fontsLoaded || !!fontsFailed;
  const { unlocked, account, devSkip, setupDone } = useSettings();
  // Private app: a server + password, then an account. (Expo Go can skip it for development.)
  const locked = !unlocked || (!account && !(__DEV__ && devSkip));

  useEffect(() => {
    (async () => {
      getDb();
      await initSettings();
      await recoverActiveDay();
      // Still allowed in? A changed server password locks the app again (checked when online;
      // offline it simply stays open). Then: share new days, fetch group challenges.
      checkServer(getSettings().serverUrl, getSettings().serverPassword).catch(() => undefined);
      syncFriends().catch(() => undefined);
      // Piste names for days still missing them, one by one while any screen is open.
      lookupStalePistes(await listSessions()).catch(() => undefined);
      registerPistesTask().catch(() => undefined);
    })()
      .catch((e) => console.warn('Startup failed', e))
      .finally(() => setReady(true));
    // Back in the app: try again the days that failed (no internet, busy server).
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') listSessions().then((all) => lookupStalePistes(all)).catch(() => undefined);
    });
    return () => sub.remove();
  }, []);

  // Nothing is drawn until the fonts are in (a few frames): Android measures text once, so a
  // screen laid out in the fallback font keeps those widths and clips its labels in Inter.
  if (!fontsDone) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  // From then on the navigator is always mounted so an invite link that launches the app is
  // routed correctly; a cover hides the screens until the database is ready.
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.bg },
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: font.medium, fontSize: size.body },
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="day/[id]" options={{ title: 'Ski day' }} />
        <Stack.Screen name="day/share" options={{ title: 'Share your day' }} />
        <Stack.Screen name="compare" options={{ title: 'Compare days' }} />
        <Stack.Screen name="run" options={{ title: 'Run' }} />
        <Stack.Screen name="sos" options={{ title: 'Emergency', presentation: 'modal' }} />
        <Stack.Screen name="segment/new" options={{ title: 'New challenge' }} />
        <Stack.Screen name="segment/[id]" options={{ title: 'Challenge' }} />
        <Stack.Screen name="c" options={{ title: 'Challenge invite' }} />
        <Stack.Screen name="group/new" options={{ title: 'Friend group' }} />
        <Stack.Screen name="group/[id]" options={{ title: 'Group' }} />
        <Stack.Screen name="player/[id]" options={{ title: 'Profile' }} />
        <Stack.Screen name="admin" options={{ title: 'Manage people' }} />
      </Stack>
      {ready && locked ? <LockScreen /> : null}
      {/* Once you're in: the first-open questions, a single time. */}
      {ready && !locked && !setupDone ? <Setup /> : null}
      {!ready ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      <DialogHost />
    </>
  );
}
