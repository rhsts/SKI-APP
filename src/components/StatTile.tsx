import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { space, useTheme, useStyles, type Palette } from '../theme';

interface Props {
  label: string;
  value: string;
  /** Shown small and muted beside the value: "km/h", "m". */
  unit?: string;
  sub?: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** A number with a small quiet label above it. No box: space and hairlines do the grouping. */
export function Figure({ label, value, unit, sub, icon, style }: Props) {
  const { s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.figure, style]} accessible accessibilityLabel={[label, value, unit, sub].filter(Boolean).join(', ')}>
      <View style={styles.head}>
        {icon}
        <Text style={s.label} numberOfLines={1}>{label}</Text>
      </View>
      <View style={styles.valueRow}>
        <Text style={[s.figure, styles.value]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        {unit ? <Text style={s.muted}>{unit}</Text> : null}
      </View>
      {sub ? <Text style={s.muted} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

/** A figure in a two-up grid, under a hairline. */
export function StatTile(props: Props) {
  const styles = useStyles(makeStyles);
  return <Figure {...props} style={styles.tile} />;
}

/** Two tiles per row. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return <View style={styles.grid}>{children}</View>;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.lg },
    figure: { gap: space.xs },
    tile: { flexBasis: '47%', flexGrow: 1, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faint },
    head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
    value: { flexShrink: 1 },
  });
