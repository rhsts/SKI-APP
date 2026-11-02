import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { listSessions, type SessionRow } from '../../db';
import { fmtAlt, fmtDate, fmtDuration, fmtSpeed } from '../../lib/format';
import { useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';
import { addDemoDay } from '../../tracking/demo';

export default function DaysScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units } = useSettings();
  const [days, setDays] = useState<SessionRow[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    listSessions().then(setDays).catch(() => setDays([]));
  }, []);
  useFocusEffect(load);

  if (!days) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={styles.list}
      data={days}
      keyExtractor={(d) => d.id}
      ListEmptyComponent={
        <View style={[s.card, styles.empty]}>
          <Ionicons name="snow-outline" size={40} color={colors.accent} />
          <Text style={s.h2}>No ski days yet</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Record a day from the Record tab, or add a demo day to see what it looks like.
          </Text>
          <Pressable
            style={styles.demo}
            disabled={adding}
            onPress={async () => {
              setAdding(true);
              try {
                await addDemoDay();
                load();
              } finally {
                setAdding(false);
              }
            }}
          >
            {adding ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.demoText}>Add a demo day</Text>}
          </Pressable>
        </View>
      }
      renderItem={({ item }) => {
        const st = item.stats;
        return (
          <Pressable style={({ pressed }) => [s.card, styles.row, pressed && { opacity: 0.85 }]} onPress={() => router.push(`/day/${item.id}`)}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.h2} numberOfLines={1}>{item.place ?? 'Ski day'}</Text>
              <Text style={s.muted}>{fmtDate(item.startedAt)}{item.isDemo ? ' · demo' : ''}</Text>
              {st ? (
                <View style={styles.metrics}>
                  <Metric icon="speedometer-outline" text={fmtSpeed(st.topSpeed, units)} />
                  <Metric icon="trending-down" text={fmtAlt(st.verticalDown, units)} />
                  <Metric icon="repeat" text={`${st.runCount} runs`} />
                  <Metric icon="time-outline" text={fmtDuration(st.skiTime)} />
                </View>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </Pressable>
        );
      }}
    />
  );
}

function Metric({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.metric}>
      <Ionicons name={icon} size={14} color={colors.accent} />
      <Text style={styles.metricText}>{text}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    list: { padding: 16, gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
    metric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metricText: { fontSize: 13, fontWeight: '700', color: colors.text },
    empty: { alignItems: 'center', gap: 10, paddingVertical: 32 },
    demo: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 6, minWidth: 160, alignItems: 'center' },
    demoText: { color: colors.onAccent, fontWeight: '800', fontSize: 16 },
  });
