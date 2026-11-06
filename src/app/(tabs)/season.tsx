import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DifficultyBar } from '../../components/DifficultyBar';
import { BadgeSheet } from '../../components/BadgeSheet';
import { StatGrid, StatTile } from '../../components/StatTile';
import { difficultyBreakdown } from '../../lib/breakdown';
import { SPORTS } from '../../lib/sport';
import { listAttempts, listSessions, motionSummaries, type SessionRow } from '../../db';
import type { MotionSummary } from '../../lib/motion';
import { computeStreaks, weeklyChallenges, type WeeklyChallenge } from '../../lib/streaks';
import { computeBadges, goalProgress, type Badge, type GoalProgress, type Goals } from '../../lib/goals';
import type { Attempt } from '../../lib/segments';
import { fmtAir, fmtAlt, fmtDate, fmtDist, fmtDuration, fmtSpeed, speedValue } from '../../lib/format';
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
  const [motion, setMotion] = useState<Record<string, MotionSummary>>({});
  const [now, setNow] = useState(0);
  const [editing, setEditing] = useState<keyof Goals | null>(null);
  const [openBadge, setOpenBadge] = useState<Badge | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setCurrentKey(seasonOf(Date.now()).key);
      setNow(Date.now());
      listSessions().then(setDays).catch(() => setDays([]));
      listAttempts().then(setAttempts).catch(() => setAttempts([]));
      motionSummaries().then(setMotion).catch(() => setMotion({}));
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
  const badges = useMemo(() => computeBadges(summaries, attempts, playerId, motion), [summaries, attempts, playerId, motion]);
  const streaks = useMemo(() => (now ? computeStreaks(summaries, now) : null), [summaries, now]);
  const weekly = useMemo(() => (now ? weeklyChallenges(summaries, motion, now) : []), [summaries, motion, now]);
  const extra = useMemo(() => {
    const inSeason = summaries.filter((d) => allTime || seasonOf(d.startedAt).key === key);
    const out = { turns: 0, jumps: 0, bestAir: 0, totalAir: 0, falls: 0 };
    for (const d of inSeason) {
      out.turns += d.stats.turns ?? 0;
      const m = motion[d.id];
      if (!m) continue;
      out.jumps += m.jumps;
      out.totalAir += m.totalAir;
      out.bestAir = Math.max(out.bestAir, m.bestAir);
      out.falls += m.falls;
    }
    return out;
  }, [summaries, motion, key, allTime]);
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
        <StatTile label="Turns" value={extra.turns.toLocaleString('en-US')} />
        <StatTile label="Jumps" value={String(extra.jumps)} sub={extra.jumps ? `Best ${fmtAir(extra.bestAir)} · total ${fmtAir(extra.totalAir)}` : undefined} />
        <StatTile label="Falls" value={String(extra.falls)} sub={season.runs ? `${(extra.falls / season.runs).toFixed(2)} per run` : undefined} />
      </StatGrid>

      {streaks ? (
        <View style={[s.card, styles.streak]}>
          <Text style={{ fontSize: 30 }}>{streaks.days >= 2 ? '🔥' : '🗓️'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.h2}>
              {streaks.days >= 2 ? `${streaks.days} days in a row!` : streaks.weeks >= 2 ? `${streaks.weeks} weeks in a row` : 'Start a streak'}
            </Text>
            <Text style={s.muted}>
              {streaks.bestDays > 0
                ? `Best: ${streaks.bestDays} ${streaks.bestDays === 1 ? 'day' : 'days'} in a row · ${streaks.bestWeeks} ${streaks.bestWeeks === 1 ? 'week' : 'weeks'} in a row`
                : 'Ski days in a row (and weeks in a row) show up here.'}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.badgeHead}>
        <Text style={s.h2}>This week’s challenges</Text>
        <Text style={s.muted}>{weekly.filter((w) => w.done).length} of {weekly.length}</Text>
      </View>
      {weekly.map((w) => <WeeklyRow key={w.kind} w={w} units={units} />)}
      <Text style={[s.muted, { fontSize: 12 }]}>New challenges every Monday, based on your own days. Finish all three for the Weekly hero badge.</Text>

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
        {badges.map((b) => <BadgeTile key={b.id} b={b} onPress={() => setOpenBadge(b)} />)}
      </View>
      <BadgeSheet
        badge={openBadge}
        onClose={() => setOpenBadge(null)}
        onOpenDay={openBadge?.dayId ? () => {
          const id = openBadge.dayId;
          setOpenBadge(null);
          router.push(`/day/${id}`);
        } : undefined}
      />

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

function weeklyText(w: WeeklyChallenge, units: Units): { title: string; value: string; target: string } {
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  switch (w.kind) {
    case 'vertical': return { title: `Ski ${fmtAlt(w.target, units)} of vertical`, value: fmtAlt(w.value, units), target: fmtAlt(w.target, units) };
    case 'topSpeed': return { title: `Hit ${fmtSpeed(w.target, units)}`, value: fmtSpeed(w.value, units), target: fmtSpeed(w.target, units) };
    case 'runs': return { title: `Ski ${n(w.target)} runs`, value: n(w.value), target: n(w.target) };
    case 'longestRun': return { title: `Ski one run of ${fmtDist(w.target, units)}`, value: fmtDist(w.value, units), target: fmtDist(w.target, units) };
    case 'days': return { title: `Ski ${n(w.target)} days`, value: n(w.value), target: n(w.target) };
    case 'turns': return { title: `Make ${n(w.target)} turns`, value: n(w.value), target: n(w.target) };
    case 'airtime': return { title: `Get ${n(w.target)} s of airtime`, value: fmtAir(w.value), target: `${n(w.target)} s` };
    case 'jumps': return { title: `Land ${n(w.target)} jumps`, value: n(w.value), target: n(w.target) };
    case 'earlyBird': return { title: 'Start a run before 9:00', value: n(w.value), target: n(w.target) };
  }
}

function WeeklyRow({ w, units }: { w: WeeklyChallenge; units: Units }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const t = weeklyText(w, units);
  return (
    <View style={[s.card, { gap: 8 }]}>
      <View style={styles.goalHead}>
        <Text style={{ fontSize: 20 }}>{w.done ? '✅' : w.emoji}</Text>
        <Text style={[s.body, { flex: 1, fontWeight: '700' }]}>{t.title}</Text>
        <Text style={s.body}>
          <Text style={{ fontWeight: '800' }}>{t.value}</Text>
          <Text style={s.muted}> / {t.target}</Text>
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.round(w.progress * 100)}%`, backgroundColor: w.done ? colors.good : colors.warn }]} />
      </View>
    </View>
  );
}

function BadgeTile({ b, onPress }: { b: Badge; onPress: () => void }) {
  const { s } = useTheme();
  const styles = useStyles(makeStyles);
  const got = b.earnedAt != null;
  return (
    <Pressable
      style={({ pressed }) => [s.card, styles.badge, !got && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.96 }] }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${b.title}: ${b.description}${got ? ' Earned.' : ' Not earned yet.'} Tap for details.`}
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
    streak: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
