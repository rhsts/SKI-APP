import { StyleSheet, Text, View } from 'react-native';
import { colors, s } from '../theme';

interface Props {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
}

export function StatTile({ label, value, sub, icon }: Props) {
  return (
    <View style={[s.card, styles.tile]}>
      <View style={styles.head}>
        {icon}
        <Text style={s.label} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={s.muted} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

/** Two tiles per row. */
export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, paddingVertical: 12, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { fontSize: 24, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
});
