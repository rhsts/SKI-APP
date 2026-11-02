import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatGrid, StatTile } from '../../components/StatTile';
import { fmtAlt, fmtClock, fmtDist, fmtDuration, fmtTimeOfDay, speedUnit, speedValue, fmtSpeed } from '../../lib/format';
import { liveStatus } from '../../lib/stats';
import { useSettings } from '../../settings';
import { colors, s } from '../../theme';
import { pauseDay, resumeDay, startDay, stopDay, useTracker } from '../../tracking/tracker';

const STATUS_LABEL = {
  skiing: { text: 'Skiing', icon: 'trending-down', color: colors.run },
  lift: { text: 'On a lift', icon: 'arrow-up', color: colors.lift },
  stopped: { text: 'Stopped', icon: 'pause', color: colors.muted },
  moving: { text: 'Moving', icon: 'walk', color: colors.good },
} as const;

export default function RecordScreen() {
  const t = useTracker();
  const { units, simulate } = useSettings();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const finish = () =>
    Alert.alert('Finish your day?', 'Your day will be saved to Days.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Finish',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            const id = await stopDay();
            if (id) router.push(`/day/${id}`);
            else Alert.alert('Too short to save', 'Record at least a minute of GPS to save a day.');
          }),
      },
    ]);

  const st = t.stats;
  const waiting = t.status === 'recording' && t.points.length === 0;
  const live = t.status === 'recording' && st ? STATUS_LABEL[liveStatus(st, t.currentSpeed)] : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      {t.recovered ? (
        <View style={[s.card, styles.banner]}>
          <Ionicons name="time-outline" size={20} color={colors.warn} />
          <Text style={[s.body, { flex: 1 }]}>
            Your day from {t.active ? fmtTimeOfDay(t.active.startedAt) : ''} wasn’t finished. Resume recording or finish it.
          </Text>
        </View>
      ) : null}

      <View style={[s.card, styles.hero]}>
        <View style={styles.chipRow}>
          {t.status === 'idle' ? (
            <Chip text={simulate ? 'Ready · simulated GPS' : 'Ready'} icon="snow" color={colors.accent} />
          ) : t.status === 'paused' ? (
            <Chip text="Paused" icon="pause" color={colors.warn} />
          ) : waiting ? (
            <Chip text="Waiting for GPS…" icon="locate" color={colors.muted} />
          ) : live ? (
            <Chip text={live.text} icon={live.icon} color={live.color} />
          ) : null}
          {t.active?.source === 'sim' ? <Chip text="Demo" icon="flask-outline" color={colors.muted} /> : null}
        </View>
        <Text style={styles.speed} adjustsFontSizeToFit numberOfLines={1}>
          {t.status === 'recording' ? speedValue(t.currentSpeed, units).toFixed(0) : '0'}
        </Text>
        <Text style={styles.speedUnit}>{speedUnit(units)}</Text>
        <Text style={s.muted}>
          {st ? `${fmtClock(st.duration)} on the mountain` : 'Tap start when you reach the slopes'}
        </Text>
      </View>

      {st || t.status !== 'idle' ? (
        <StatGrid>
          <StatTile label="Top speed" value={fmtSpeed(st?.topSpeed ?? 0, units)} />
          <StatTile label="Vertical ↓" value={fmtAlt(st?.verticalDown ?? 0, units)} />
          <StatTile label="Runs" value={String(st?.runCount ?? 0)} sub={`${st?.liftCount ?? 0} lifts`} />
          <StatTile label="Ski time" value={fmtDuration(st?.skiTime ?? 0)} sub={`Lifts ${fmtDuration(st?.liftTime ?? 0)}`} />
          <StatTile label="Distance" value={fmtDist(st?.distance ?? 0, units)} sub={`Skied ${fmtDist(st?.skiDistance ?? 0, units)}`} />
          <StatTile label="Altitude" value={fmtAlt(t.points.length ? t.points[t.points.length - 1].alt : null, units)} sub={st?.maxAlt != null ? `Max ${fmtAlt(st.maxAlt, units)}` : undefined} />
        </StatGrid>
      ) : (
        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.h2}>How it works</Text>
          <Text style={s.body}>
            Start recording at the lift and put your phone in your pocket. Every run and lift ride is detected
            automatically: top speed, vertical, distance and time on the snow.
          </Text>
          {simulate ? (
            <Text style={s.muted}>Simulated GPS is on (Profile): a fake ski day plays at 20× speed.</Text>
          ) : null}
        </View>
      )}

      {t.foregroundOnly && t.status === 'recording' ? (
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Background location isn’t allowed, so keep the app open. Allow location “All the time” to track with the screen off.
        </Text>
      ) : null}
      {t.error ? <Text style={[s.body, { color: colors.danger, textAlign: 'center' }]}>{t.error}</Text> : null}

      <View style={styles.buttons}>
        {busy ? (
          <ActivityIndicator color={colors.accent} size="large" />
        ) : t.status === 'idle' ? (
          <Button label="Start day" icon="play" color={colors.accent} big onPress={() => run(() => startDay(simulate))} />
        ) : (
          <>
            {t.status === 'recording' ? (
              <Button label="Pause" icon="pause" color={colors.warn} onPress={() => run(pauseDay)} />
            ) : (
              <Button label="Resume" icon="play" color={colors.accent} onPress={() => run(resumeDay)} />
            )}
            <Button label="Finish" icon="stop" color={colors.danger} onPress={finish} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Chip({ text, icon, color }: { text: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string }) {
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.chipText, { color }]}>{text}</Text>
    </View>
  );
}

function Button({ label, icon, color, onPress, big }: {
  label: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string; onPress: () => void; big?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, big && styles.bigButton, { backgroundColor: color, opacity: pressed ? 0.8 : 1 }]}
    >
      <Ionicons name={icon} size={big ? 24 : 20} color="#fff" />
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'center', borderLeftWidth: 4, borderLeftColor: colors.warn },
  hero: { alignItems: 'center', paddingVertical: 20, gap: 2 },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 13, fontWeight: '700' },
  speed: { fontSize: 96, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'], lineHeight: 104 },
  speedUnit: { fontSize: 18, fontWeight: '700', color: colors.muted, marginTop: -6, marginBottom: 6 },
  buttons: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginTop: 4 },
  button: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14 },
  bigButton: { paddingVertical: 20 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '800' },
});
