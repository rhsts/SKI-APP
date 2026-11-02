import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatGrid, StatTile } from '../../components/StatTile';
import { listSessions, type SessionRow } from '../../db';
import { fmtAlt, fmtDate, fmtDist, fmtDuration, fmtSpeed } from '../../lib/format';
import { seasonKeys, seasonOf, summariseSeason, type DaySummary, type SeasonRecord } from '../../lib/season';
import { useSettings } from '../../settings';
import { colors, s } from '../../theme';

export default function SeasonScreen() {
  const { units } = useSettings();
  const [days, setDays] = useState<SessionRow[]>([]);
  const [picked, setPicked] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { listSessions().then(setDays).catch(() => setDays([])); }, []));

  const summaries: DaySummary[] = useMemo(
    () => days.filter((d) => d.stats).map((d) => ({ id: d.id, startedAt: d.startedAt, place: d.place, stats: d.stats! })),
    [days],
  );
  const keys = useMemo(() => {
    const k = seasonKeys(summaries);
    const now = seasonOf(Date.now()).key;
    return k.includes(now) ? k : [now, ...k];
  }, [summaries]);
  const key = picked && keys.includes(picked) ? picked : keys[0];
  const season = useMemo(() => summariseSeason(key, summaries), [key, summaries]);
  const r = season.records;

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {keys.map((k) => (
          <Pressable key={k} onPress={() => setPicked(k)} style={[styles.pill, k === key && styles.pillOn]}>
            <Text style={[styles.pillText, k === key && { color: '#fff' }]}>Season {k}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[s.card, styles.hero]}>
        <Text style={s.label}>Vertical this season</Text>
        <Text style={styles.big}>{fmtAlt(season.verticalDown, units)}</Text>
        <Text style={s.muted}>
          {season.days} {season.days === 1 ? 'day' : 'days'}
          {season.places.length ? ` · ${season.places.slice(0, 3).join(', ')}${season.places.length > 3 ? '…' : ''}` : ''}
        </Text>
      </View>

      <StatGrid>
        <StatTile label="Ski days" value={String(season.days)} />
        <StatTile label="Runs" value={String(season.runs)} />
        <StatTile label="Distance skied" value={fmtDist(season.skiDistance, units)} />
        <StatTile label="Time skiing" value={fmtDuration(season.skiTime)} />
      </StatGrid>

      <Text style={[s.h2, { marginTop: 8 }]}>Personal records</Text>
      <RecordRow icon="speedometer" label="Fastest speed" rec={r.topSpeed} fmt={(v) => fmtSpeed(v, units)} />
      <RecordRow icon="resize" label="Longest run" rec={r.longestRun} fmt={(v) => fmtDist(v, units)} />
      <RecordRow icon="trending-down" label="Most vertical in a day" rec={r.mostVertical} fmt={(v) => fmtAlt(v, units)} />
      <RecordRow icon="repeat" label="Most runs in a day" rec={r.mostRuns} fmt={(v) => `${v} runs`} />
      <RecordRow icon="time" label="Most time skiing in a day" rec={r.longestDay} fmt={fmtDuration} />
    </ScrollView>
  );
}

function RecordRow({ icon, label, rec, fmt }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; rec: SeasonRecord | null; fmt: (v: number) => string;
}) {
  return (
    <Pressable
      disabled={!rec}
      onPress={() => rec && router.push(`/day/${rec.dayId}`)}
      style={({ pressed }) => [s.card, styles.record, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.medal}><Ionicons name={icon} size={20} color={colors.warn} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        <Text style={styles.recValue}>{rec ? fmt(rec.value) : '–'}</Text>
      </View>
      {rec ? <Text style={s.muted}>{fmtDate(rec.date)}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.faint },
  pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { fontWeight: '700', color: colors.text },
  hero: { alignItems: 'center', gap: 4, paddingVertical: 20 },
  big: { fontSize: 44, fontWeight: '900', color: colors.text },
  record: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  medal: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFF4E0', alignItems: 'center', justifyContent: 'center' },
  recValue: { fontSize: 20, fontWeight: '800', color: colors.text },
});
