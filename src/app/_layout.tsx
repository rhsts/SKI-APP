// Registers the background GPS task before anything else, so Android can deliver
// locations to it even when it starts the app headless with the screen off.
import '../tracking/task';

import Stack from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
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

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="day/[id]" options={{ title: 'Ski day', headerBackTitle: 'Back' }} />
      </Stack>
    </>
  );
}
