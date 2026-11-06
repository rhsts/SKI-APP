import { StyleSheet, Text, View } from 'react-native';
import type { DifficultyShare } from '../lib/breakdown';
import { fmtAlt, fmtDuration } from '../lib/format';
import { difficultyColor, difficultyLabel } from '../lib/pistes';
import type { Units } from '../lib/types';
import { useStyles, useTheme, type Palette } from '../theme';

/** Time on each piste difficulty: a stacked bar plus a row per difficulty. */
export function DifficultyBar({ shares, units, title = 'Pistes' }: { shares: DifficultyShare[]; units: Units; title?: string }) {
  const { s, dark } = useTheme();
  const styles = useStyles(makeStyles);
  if (!shares.length) return null;
  return (
    <View style={[s.card, { gap: 10 }]}>
      <Text style={s.label}>{title}</Text>
      <View style={styles.bar}>
        {shares.map((d) => (
          <View key={String(d.difficulty)} style={{ flex: Math.max(d.share, 0.02), backgroundColor: difficultyColor(d.difficulty, dark) }} />
        ))}
      </View>
      {shares.map((d) => (
        <View key={String(d.difficulty)} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: difficultyColor(d.difficulty, dark) }]} />
          <Text style={[s.body, styles.name]} numberOfLines={1}>{difficultyLabel(d.difficulty) ?? 'Piste unknown'}</Text>
          <Text style={[s.muted, styles.detail]} numberOfLines={1}>
            {d.runs} {d.runs === 1 ? 'run' : 'runs'} · {fmtDuration(d.time)} · {fmtAlt(d.vertical, units)}
          </Text>
          <Text style={styles.pct}>{Math.round(d.share * 100)}%</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    bar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.faint },
    // The label keeps its full width; the details line gives way (ellipsis) on narrow screens.
    name: { flexShrink: 0, maxWidth: '50%', fontWeight: '700' },
    detail: { flex: 1, flexShrink: 1, textAlign: 'right' },
    pct: { width: 40, textAlign: 'right', fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  });
