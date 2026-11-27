import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Tap } from '../../components/Tap';
import { useTabBarSpace } from '../../components/TabBar';
import { listSessions, type SessionRow } from '../../db';
import { fmtAlt, fmtDuration, fmtSpeed } from '../../lib/format';
import { difficultyColor, type Difficulty } from '../../lib/pistes';
import { sportInfo } from '../../lib/sport';
import { useSettings } from '../../settings';
import { addDemoDay } from '../../tracking/demo';
import { font, radius, size, space, target, useStyles, useTheme, type Palette } from '../../theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Days grouped by month, newest first (the list already comes newest first). */
function byMonth(days: SessionRow[]): { title: string; data: SessionRow[] }[] {
  const out: { title: string; data: SessionRow[] }[] = [];
  for (const d of days) {
    const at = new Date(d.startedAt);
    const title = `${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
    if (out[out.length - 1]?.title !== title) out.push({ title, data: [] });
    out[out.length - 1].data.push(d);
  }
  return out;
}

/** Runs per difficulty, hardest last, from the pistes each run was matched to. */
function pisteMix(pistes: SessionRow['pistes']): { d: Difficulty; n: number }[] {
  if (!pistes) return [];
  const order: Difficulty[] = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride'];
  const count = new Map<Difficulty, number>();
  for (const p of Object.values(pistes)) {
    if (!order.includes(p.difficulty)) continue;
    count.set(p.difficulty, (count.get(p.difficulty) ?? 0) + 1);
  }
  return order.filter((d) => count.has(d)).map((d) => ({ d, n: count.get(d)! }));
}

export default function DaysScreen() {
  const { colors, s, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const { units } = useSettings();
  const tabSpace = useTabBarSpace();
  const navigation = useNavigation();
  const [days, setDays] = useState<SessionRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  // Compare mode: pick two days.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const sections = useMemo(() => byMonth(days ?? []), [days]);

  const toggle = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-2);
    setPicked(next);
    if (next.length === 2) {
      setPicking(false);
      setPicked([]);
      router.push({ pathname: '/compare', params: { a: next[0], b: next[1] } });
    }
  };

  const load = useCallback(() => {
    listSessions().then(setDays).catch(() => setDays([]));
  }, []);
  useFocusEffect(load);

  // Compare lives in the header, out of the way of the days themselves.
  const canCompare = (days?.length ?? 0) >= 2;
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: canCompare
        ? () => (
            <Pressable
              onPress={() => { setPicking((p) => !p); setPicked([]); }}
              style={styles.headerAction}
              hitSlop={space.sm}
              accessibilityRole="button"
            >
              <Text style={styles.headerActionText}>{picking ? 'Cancel' : 'Compare'}</Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, canCompare, picking, styles]);

  if (!days) return <ActivityIndicator style={{ marginTop: space.xxxl }} color={colors.accent} />;

  const altUnit = units === 'metric' ? 'm' : 'ft';

  return (
    <SectionList
      style={s.screen}
      contentContainerStyle={[styles.list, { paddingBottom: tabSpace }]}
      sections={sections}
      keyExtractor={(d) => d.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        picking ? (
          <Text style={[s.body, styles.hint]}>Pick {2 - picked.length} {picked.length ? 'more day' : 'days'} to compare.</Text>
        ) : undefined
      }
      renderSectionHeader={({ section }) => <Text style={[s.label, styles.month]}>{section.title}</Text>}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={s.h1}>No ski days yet</Text>
          <Text style={[s.body, { color: colors.muted }]}>
            Start recording on the Record tab, or add a demo day to see how a day looks.
          </Text>
          <Pressable
            style={styles.demo}
            disabled={adding}
            accessibilityRole="button"
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
      renderItem={({ item, index }) => {
        const st = item.stats;
        const at = new Date(item.startedAt);
        const on = picked.includes(item.id);
        const mix = pisteMix(item.pistes);
        const total = mix.reduce((n, m) => n + m.n, 0);
        const extra = [item.sport !== 'ski' ? sportInfo(item.sport).label : null, item.isDemo ? 'Demo' : null].filter(Boolean).join(', ');
        return (
          <Tap
            style={[styles.row, index === 0 && styles.first]}
            onPress={() => (picking ? toggle(item.id) : router.push(`/day/${item.id}`))}
            accessibilityState={picking ? { selected: on } : undefined}
          >
            {/* The date as a calendar stub: weekday over day of month. */}
            <View style={[styles.date, on && styles.dateOn]}>
              <Text style={[styles.weekday, on && { color: colors.onAccent }]}>{WEEKDAYS[at.getDay()]}</Text>
              <Text style={[styles.dayNum, on && { color: colors.onAccent }]}>{at.getDate()}</Text>
            </View>
            <View style={styles.middle}>
              <Text style={s.h2} numberOfLines={1}>{item.place ?? 'Ski day'}</Text>
              {st ? (
                <Text style={[s.muted, styles.tabular]} numberOfLines={1}>
                  {st.runCount} {st.runCount === 1 ? 'run' : 'runs'}, {fmtSpeed(st.topSpeed, units)} top, {fmtDuration(st.skiTime)}
                </Text>
              ) : null}
              {extra ? <Text style={s.muted}>{extra}</Text> : null}
              {total ? (
                <View style={styles.mix} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {mix.map((m) => (
                    <View key={m.d} style={{ flex: m.n, backgroundColor: difficultyColor(m.d, dark) }} />
                  ))}
                </View>
              ) : null}
            </View>
            {st ? (
              <View style={styles.right}>
                <Text style={s.figure}>{fmtAlt(st.verticalDown, units, false)}</Text>
                <Text style={s.muted}>{altUnit} down</Text>
              </View>
            ) : null}
          </Tap>
        );
      }}
    />
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    list: { paddingHorizontal: space.lg, paddingTop: space.sm },
    hint: { paddingVertical: space.md },
    month: { paddingTop: space.xl, paddingBottom: space.sm },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: space.lg,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.faint,
    },
    first: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faint },
    date: {
      width: target.min + space.xs, height: target.min + space.md, borderRadius: radius.control,
      backgroundColor: colors.liftSoft, alignItems: 'center', justifyContent: 'center',
    },
    dateOn: { backgroundColor: colors.accent },
    weekday: { fontFamily: font.medium, fontSize: size.label, lineHeight: 14, color: colors.muted },
    dayNum: { fontFamily: font.regular, fontSize: size.control, lineHeight: 26, color: colors.text, fontVariant: ['tabular-nums'] },
    middle: { flex: 1, gap: 2 },
    tabular: { fontVariant: ['tabular-nums'] },
    mix: { flexDirection: 'row', height: 3, borderRadius: 2, overflow: 'hidden', gap: 2, marginTop: space.sm, maxWidth: 160 },
    right: { alignItems: 'flex-end' },
    headerAction: { paddingHorizontal: space.lg, minHeight: target.min, justifyContent: 'center' },
    headerActionText: { fontFamily: font.medium, fontSize: size.body, color: colors.accent },
    empty: { gap: space.md, paddingTop: space.xxxl },
    demo: {
      alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radius.control, paddingHorizontal: space.xl,
      minHeight: target.min + space.xs, justifyContent: 'center', marginTop: space.sm, minWidth: 160, alignItems: 'center',
    },
    demoText: { fontFamily: font.medium, fontSize: size.body, color: colors.onAccent },
  });
