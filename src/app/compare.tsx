import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getPoints, getSession, listSegments, listSessionAttempts, type SessionRow } from '../db';
import { compareDays, sameArea, type CompareRow } from '../lib/compare';
import { fmtAlt, fmtDate, fmtDelta, fmtDist, fmtDuration, fmtRaceTime, fmtSpeed } from '../lib/format';
import { computeStats } from '../lib/stats';
import type { Units } from '../lib/types';
import { useSettings } from '../settings';
import { useStyles, useTheme, type Palette } from '../theme';

interface Loaded {
  a: SessionRow;
  b: SessionRow;
  rows: CompareRow[];
  same: boolean;
  /** Challenges skied on both days: best time each day. */
  shared: { name: string; segmentId: string; a: number; b: number }[];
}

/** Two days side by side: are you getting faster? */
export default function CompareScreen() {
  const { a: idA, b: idB } = useLocalSearchParams<{ a: string; b: string }>();
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units } = useSettings();
  const [data, setData] = useState<Loaded | null>(null);

  useEffect(() => {
    (async () => {
      const [sa, sb, pa, pb, xa, xb, segs] = await Promise.all([
        getSession(idA), getSession(idB), getPoints(idA), getPoints(idB),
        listSessionAttempts(idA), listSessionAttempts(idB), listSegments(),
      ]);
      if (!sa || !sb) return;
      // Older day on the left.
      const swap = sa.startedAt > sb.startedAt;
      const [A, B, PA, PB, XA, XB] = swap ? [sb, sa, pb, pa, xb, xa] : [sa, sb, pa, pb, xa, xb];
      const best = (xs: typeof XA, seg: string) => xs.filter((x) => x.segmentId === seg).reduce((m, x) => Math.min(m, x.time), Infinity);
      const shared = segs
        .map((g) => ({ name: g.name, segmentId: g.id, a: best(XA, g.id), b: best(XB, g.id) }))
        .filter((r) => Number.isFinite(r.a) && Number.isFinite(r.b));
      setData({ a: A, b: B, rows: compareDays(computeStats(PA), computeStats(PB)), same: sameArea(PA, PB), shared });
    })();
  }, [idA, idB]);

  if (!data) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;
  const { a, b, rows, same, shared } = data;

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <View style={styles.headRow}>
        <DayHead day={a} />
        <Text style={styles.vs}>vs</Text>
        <DayHead day={b} />
      </View>
      <Text style={[s.muted, { textAlign: 'center' }]}>
        {same ? 'Same mountain, so it’s a fair comparison.' : 'Different places, so terrain plays a part.'}
      </Text>

      <View style={[s.card, { paddingVertical: 4 }]}>
        {rows.map((r, i) => (
          <View key={r.key} style={[styles.row, i > 0 && styles.rowBorder]}>
            <Text style={[styles.val, r.winner === 'a' && styles.win]}>{fmt(r.a, r.kind, units)}</Text>
            <Text style={styles.rowLabel}>{r.label}</Text>
            <Text style={[styles.val, { textAlign: 'right' }, r.winner === 'b' && styles.win]}>{fmt(r.b, r.kind, units)}</Text>
          </View>
        ))}
      </View>

      {shared.length ? (
        <View style={[s.card, { gap: 12 }]}>
          <Text style={s.label}>Challenges skied both days</Text>
          {shared.map((c) => {
            const d = c.b - c.a;
            return (
              <Pressable key={c.segmentId} onPress={() => router.push(`/segment/${c.segmentId}`)} style={styles.row}>
                <Text style={[styles.val, d > 0 && styles.win]}>{fmtRaceTime(c.a)}</Text>
                <Text style={styles.rowLabel} numberOfLines={1}>🏁 {c.name}</Text>
                <Text style={[styles.val, { textAlign: 'right' }, d < 0 && styles.win]}>
                  {fmtRaceTime(c.b)}{'\n'}
                  <Text style={[s.muted, { color: d < 0 ? colors.good : colors.danger }]}>{fmtDelta(d)}</Text>
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

function DayHead({ day }: { day: SessionRow }) {
  const { s } = useTheme();
  return (
    <Pressable style={{ flex: 1, alignItems: 'center' }} onPress={() => router.push(`/day/${day.id}`)}>
      <Text style={[s.h2, { textAlign: 'center' }]} numberOfLines={2}>{day.place ?? 'Ski day'}</Text>
      <Text style={s.muted}>{fmtDate(day.startedAt)}</Text>
    </Pressable>
  );
}

function fmt(v: number, kind: CompareRow['kind'], units: Units): string {
  switch (kind) {
    case 'speed': return fmtSpeed(v, units);
    case 'alt': return fmtAlt(v, units);
    case 'dist': return fmtDist(v, units);
    case 'duration': return fmtDuration(v);
    default: return String(Math.round(v));
  }
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    vs: { fontSize: 15, fontWeight: '700', color: colors.muted },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 8 },
    rowBorder: { borderTopWidth: 1, borderTopColor: colors.faint },
    rowLabel: { flex: 1.2, textAlign: 'center', fontSize: 13, fontWeight: '500', color: colors.muted },
    val: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
    win: { color: colors.good, fontWeight: '700' },
  });
