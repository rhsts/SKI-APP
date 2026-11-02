import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fmtAlt, fmtDist, fmtDuration, fmtSpeed, fmtTimeOfDay } from '../lib/format';
import { difficultyColor, difficultyLabel, type PisteMatch } from '../lib/pistes';
import type { Activity, Units } from '../lib/types';
import { useTheme, useStyles, type Palette } from '../theme';

interface Props {
  activity: Activity;
  number: number; // run or lift number of the day
  units: Units;
  selected?: boolean;
  onPress?: () => void;
  /** Shown on runs: turn this run into a challenge. */
  onChallenge?: () => void;
  /** The piste this run was on, from OpenStreetMap. */
  piste?: PisteMatch | null;
}

/** One entry in the day's timeline: a run or a lift ride. */
export function TimelineCard({ activity: a, number, units, selected, onPress, onChallenge, piste }: Props) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const isRun = a.kind === 'run';
  const tint = isRun ? colors.run : colors.lift;
  return (
    <Pressable onPress={onPress} style={[s.card, styles.card, selected && { borderColor: tint }]}>
      <View style={[styles.icon, { backgroundColor: isRun ? colors.accentSoft : colors.liftSoft }]}>
        <Ionicons name={isRun ? 'trending-down' : 'arrow-up'} size={20} color={tint} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.row}>
          <Text style={s.h2}>{isRun ? `Run ${number}` : `Lift ${number}`}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={s.muted}>{fmtTimeOfDay(a.startTime)} · {fmtDuration(a.duration)}</Text>
            {isRun && onChallenge ? (
              <Pressable onPress={onChallenge} hitSlop={10} accessibilityLabel={`Make run ${number} a challenge`}>
                <Ionicons name="flag-outline" size={20} color={colors.accent} />
              </Pressable>
            ) : null}
          </View>
        </View>
        {isRun && piste ? (
          <View style={styles.pisteRow}>
            <View style={[styles.dot, { backgroundColor: difficultyColor(piste.difficulty) }]} />
            <Text style={[s.body, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>
              {piste.name ?? difficultyLabel(piste.difficulty) ?? 'Piste'}
              {piste.name && difficultyLabel(piste.difficulty) ? <Text style={s.muted}>  {difficultyLabel(piste.difficulty)}</Text> : null}
            </Text>
          </View>
        ) : null}
        {isRun ? (
          <View style={styles.row}>
            <Metric label="Top" value={fmtSpeed(a.topSpeed, units)} />
            <Metric label="Avg" value={fmtSpeed(a.avgSpeed, units)} />
            <Metric label="Vertical" value={fmtAlt(a.verticalDown, units)} />
            <Metric label="Dist" value={fmtDist(a.distance, units)} />
          </View>
        ) : (
          <View style={styles.row}>
            <Metric label="Up" value={fmtAlt(a.verticalUp, units)} />
            <Metric label="Dist" value={fmtDist(a.distance, units)} />
            <Metric label="Speed" value={fmtSpeed(a.avgSpeed, units)} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const { s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View>
      <Text style={[s.label, { fontSize: 10 }]}>{label}</Text>
      <Text style={styles.metric}>{value}</Text>
    </View>
  );
}

/** A break between activities (lunch, waiting), only shown when it's long enough to matter. */
export function BreakRow({ activity }: { activity: Activity }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.breakRow}>
      <Ionicons name="cafe-outline" size={14} color={colors.muted} />
      <Text style={s.muted}>Break · {fmtDuration(activity.duration)}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    card: { flexDirection: 'row', gap: 12, alignItems: 'center', borderWidth: 2, borderColor: 'transparent', paddingVertical: 12 },
    icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
    metric: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
    pisteRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
    breakRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 2 },
  });
