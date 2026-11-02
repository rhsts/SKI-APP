import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DifficultyBar } from '../../components/DifficultyBar';
import { StatGrid, StatTile } from '../../components/StatTile';
import { difficultyBreakdown } from '../../lib/breakdown';
import { SPORTS } from '../../lib/sport';
import { listAttempts, listSessions, type SessionRow } from '../../db';
import { computeBadges, goalProgress, type Badge, type GoalProgress, type Goals } from '../../lib/goals';
import type { Attempt } from '../../lib/segments';
import { fmtAlt, fmtDate, fmtDist, fmtDuration, fmtSpeed, speedValue } from '../../lib/format';
import type { Units } from '../../lib/types';
import { ALL_TIME, seasonKeys, seasonOf, summariseSeason, type DaySummary, type SeasonRecord } from '../../lib/season';
import { updateSettings, useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';

export default function SeasonScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units, goals, playerId } = useSettings();
  const [days, setDays] = useState<SessionRow[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [now, setNow] = useState(0);
  const [editing, setEditing] = useState<keyof Goals | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setCurrentKey(seasonOf(Date.now()).key);
      setNow(Date.now());
      listSessions().then(setDays).catch(() => setDays([]));
      listAttempts().then(setAttempts).catch(() => setAttempts([]));
    }, []),
  );

  const summaries: DaySummary[] = useMemo(
    () => days.filter((d) => d.stats).map((d) => ({ id: d.id, startedAt: d.startedAt, place: d.place, stats: d.stats!, sport: d.sport })),
    [days],
  );
  const keys = useMemo(() => {
    const k = seasonKeys(summaries);
    const withCurrent = !currentKey || k.includes(currentKey) ? k : [currentKey, ...k];
    return [...withCurrent, ALL_TIME];
  }, [summaries, currentKey]);
  const key = picked && keys.includes(picked) ? picked : keys[0];
  const season = useMemo(() => summariseSeason(key, summaries), [key, summaries]);
  const r = season.records;
  const allTime = key === ALL_TIME;
  const shares = useMemo(
    () => difficultyBreakdown(
      days.filter((d) => d.stats && (allTime || seasonOf(d.startedAt).key === key)).map((d) => ({ activities: d.stats!.activities, pistes: d.pistes })),
    ),
    [days, key, allTime],
  );
  const progress = useMemo(() => (now ? goalProgress(summaries, goals, now) : []), [summaries, goals, now]);
  const badges = useMemo(() => computeBadges(summaries, attempts, playerId), [summaries, attempts, playerId]);
  const earned = badges.filter((b) => b.earnedAt != null).length;

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {keys.map((k) => (
          <Pressable key={k} onPress={() => setPicked(k)} style={[styles.pill, k === key && styles.pillOn]}>
            <Text style={[styles.pillText, k === key && { color: colors.onAccent }]}>{k === ALL_TIME ? 'All time' : `Season ${k}`}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[s.card, styles.hero]}>
        <Text style={s.label}>{allTime ? 'Vertical, all time' : 'Vertical this season'}</Text>
        <Text style={styles.big}>{fmtAlt(season.verticalDown, units)}</Text>
        <Text style={s.muted}>
          {season.days} {season.days === 1 ? 'day' : 'days'}
          {allTime && season.seasons.size ? ` · ${season.seasons.size} ${season.seasons.size === 1 ? 'season' : 'seasons'}` : ''}
          {season.places.length ? ` · ${season.places.slice(0, 3).join(', ')}${season.places.length > 3 ? '…' : ''}` : ''}
        </Text>
        {Object.keys(season.sports).length > 1 || (Object.keys(season.sports)[0] ?? 'ski') !== 'ski' ? (
          <Text style={s.muted}>
            {SPORTS.filter((sp) => season.sports[sp.id]).map((sp) => `${sp.emoji} ${season.sports[sp.id]}`).join('   ')}
          </Text>
        ) : null}
      </View>

      <StatGrid>
        <StatTile label="Ski days" value={String(season.days)} />
        <StatTile label="Runs" value={String(season.runs)} />
        <StatTile label="Distance skied" value={fmtDist(season.skiDistance, units)} />
        <StatTile label="Time skiing" value={fmtDuration(season.skiTime)} />
        <StatTile label="In lift lines" value={fmtDuration(season.liftWaitTime)} />
        {season.tourVertical > 0 ? <StatTile label="Climbed on skins" value={fmtAlt(season.tourVertical, units)} /> : null}
      </StatGrid>

      <DifficultyBar shares={shares} units={units} title={allTime ? 'Pistes, all time' : 'Pistes this season'} />

      <Text style={[s.h2, { marginTop: 8 }]}>Goals</Text>
      {progress.map((g) => (
        <GoalRow
          key={g.key}
          g={g}
          units={units}
          editing={editing === g.key}
          onToggle={() => setEditing(editing === g.key ? null : g.key)}
          onChange={(target) => updateSettings({ goals: { ...goals, [g.key]: target } })}
        />
      ))}

      <View style={styles.badgeHead}>
        <Text style={s.h2}>Badges</Text>
        <Text style={s.muted}>{earned} of {badges.length}</Text>
      </View>
      <View style={styles.badgeGrid}>
        {badges.map((b) => <BadgeTile key={b.id} b={b} />)}
      </View>

      <Text style={[s.h2, { marginTop: 8 }]}>{allTime ? 'All-time records' : 'Personal records'}</Text>
      <RecordRow icon="speedometer" label="Fastest speed" rec={r.topSpeed} fmt={(v) => fmtSpeed(v, units)} />
      <RecordRow icon="resize" label="Longest run" rec={r.longestRun} fmt={(v) => fmtDist(v, units)} />
      <RecordRow icon="trending-down" label="Most vertical in a day" rec={r.mostVertical} fmt={(v) => fmtAlt(v, units)} />
      <RecordRow icon="repeat" label="Most runs in a day" rec={r.mostRuns} fmt={(v) => `${v} runs`} />
      <RecordRow icon="time" label="Most time skiing in a day" rec={r.longestDay} fmt={fmtDuration} />
    </ScrollView>
  );
}

const GOAL_TEXT: Record<keyof Goals, { title: string; period: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  weeklyVertical: { title: 'Vertical', period: 'this week', icon: 'trending-down' },
  seasonTopSpeed: { title: 'Top speed', period: 'this season', icon: 'speedometer' },
  seasonDays: { title: 'Ski days', period: 'this season', icon: 'calendar' },
};

function fmtGoal(key: keyof Goals, v: number, units: Units): string {
  if (key === 'weeklyVertical') return fmtAlt(v, units);
  if (key === 'seasonTopSpeed') return fmtSpeed(v, units).replace('.0 ', ' ');
  return `${Math.round(v)}`;
}

/** − / + step for each goal, in the units shown. */
function stepGoal(key: keyof Goals, target: number, dir: 1 | -1, units: Units): number {
  if (key === 'weeklyVertical') {
    const step = units === 'metric' ? 1000 : 3000 / 3.28084;
    return Math.max(step, Math.round((target + dir * step) / step) * step);
  }
  if (key === 'seasonTopSpeed') {
    const perUnit = speedValue(1, units); // display units per m/s
    const shown = Math.round(speedValue(target, units) / 5) * 5 + dir * 5;
    return Math.max(10, shown) / perUnit;
  }
  return Math.max(1, Math.round(target) + dir);
}

function GoalRow({ g, units, editing, onToggle, onChange }: {
  g: GoalProgress; units: Units; editing: boolean; onToggle: () => void; onChange: (target: number) => void;
}) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const t = GOAL_TEXT[g.key];
  return (
    <Pressable onPress={onToggle} style={[s.card, { gap: 8 }]} accessibilityHint="Tap to change the goal">
      <View style={styles.goalHead}>
        <Ionicons name={g.done ? 'checkmark-circle' : t.icon} size={20} color={g.done ? colors.good : colors.accent} />
        <Text style={[s.body, { flex: 1, fontWeight: '700' }]}>{t.title} {t.period}</Text>
        <Text style={s.body}>
          <Text style={{ fontWeight: '800' }}>{fmtGoal(g.key, g.value, units)}</Text>
          <Text style={s.muted}> / {fmtGoal(g.key, g.target, units)}</Text>
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round(g.progress * 100)}%`, backgroundColor: g.done ? colors.good : colors.accent }]} />
      </View>
      {editing ? (
        <View style={styles.stepper}>
          <Pressable onPress={() => onChange(stepGoal(g.key, g.target, -1, units))} style={styles.stepBtn} accessibilityLabel="Lower goal">
            <Ionicons name="remove" size={22} color={colors.accent} />
          </Pressable>
          <Text style={[s.h2, { minWidth: 110, textAlign: 'center' }]}>{fmtGoal(g.key, g.target, units)}</Text>
          <Pressable onPress={() => onChange(stepGoal(g.key, g.target, 1, units))} style={styles.stepBtn} accessibilityLabel="Raise goal">
            <Ionicons name="add" size={22} color={colors.accent} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function BadgeTile({ b }: { b: Badge }) {
  const { s } = useTheme();
  const styles = useStyles(makeStyles);
  const got = b.earnedAt != null;
  return (
    <Pressable
      style={[s.card, styles.badge, !got && { opacity: 0.45 }]}
      disabled={!b.dayId}
      onPress={() => b.dayId && router.push(`/day/${b.dayId}`)}
      accessibilityLabel={`${b.title}: ${b.description}${got ? ' Earned.' : ' Not earned yet.'}`}
    >
      <Text style={{ fontSize: 30 }}>{got ? b.emoji : '🔒'}</Text>
      <Text style={styles.badgeTitle} numberOfLines={1}>{b.title}</Text>
      <Text style={[s.muted, { fontSize: 11, textAlign: 'center' }]} numberOfLines={2}>
        {got ? fmtDate(b.earnedAt!).slice(4) : b.description}
      </Text>
    </Pressable>
  );
}

function RecordRow({ icon, label, rec, fmt }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; label: string; rec: SeasonRecord | null; fmt: (v: number) => string;
}) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
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

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.faint },
    pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    pillText: { fontWeight: '700', color: colors.text },
    hero: { alignItems: 'center', gap: 4, paddingVertical: 20 },
    big: { fontSize: 44, fontWeight: '900', color: colors.text },
    goalHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.faint, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4 },
    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
    stepBtn: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    badgeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 },
    badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    badge: { width: '31%', alignItems: 'center', gap: 2, paddingVertical: 12, paddingHorizontal: 6 },
    badgeTitle: { fontSize: 13, fontWeight: '800', color: colors.text, textAlign: 'center' },
    record: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    medal: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' },
    recValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  });
