// Registers the background GPS task before anything else, so Android can deliver
// locations to it even when it starts the app headless with the screen off.
import '../tracking/task';

import Stack from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { getDb } from '../db';
import { initSettings } from '../settings';
import { colors } from '../theme';
import { recoverActiveDay } from '../tracking/tracker';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      getDb();
      await initSettings();
      await recoverActiveDay();
    })()
      .catch((e) => console.warn('Startup failed', e))
      .finally(() => setReady(true));
  }, []);

  // The navigator is always mounted so an invite link that launches the app is
  // routed correctly; a cover hides the screens until the database is ready.
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg }, headerBackTitle: 'Back' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="day/[id]" options={{ title: 'Ski day' }} />
        <Stack.Screen name="segment/new" options={{ title: 'New challenge' }} />
        <Stack.Screen name="segment/[id]" options={{ title: 'Challenge' }} />
        <Stack.Screen name="c" options={{ title: 'Challenge invite' }} />
      </Stack>
      {!ready ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </>
  );
}
