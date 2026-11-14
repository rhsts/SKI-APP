import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { space, useStyles, useTheme, type Palette } from '../theme';
import { Appear } from './Appear';

/** A list of rows separated by hairlines, in place of a stack of boxed cards. */
export function Rows({ children }: { children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return <View style={styles.rows}>{children}</View>;
}

interface RowProps {
  label: string;
  value?: string;
  /** Draw the value in the text colour (a reading) instead of muted (a hint). */
  strong?: boolean;
  /** Makes the row a button with a chevron. */
  onPress?: () => void;
  /** With children: whether they are shown under the row. */
  open?: boolean;
  /** Replaces the chevron, e.g. a spinner. */
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}

/** One line: what it is on the left, its value on the right. Can open to show more underneath. */
export function Row({ label, value, strong, onPress, open, trailing, children }: RowProps) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const head = (
    <>
      <Text style={s.body}>{label}</Text>
      <View style={styles.right}>
        {value ? <Text style={[s.body, styles.value, !strong && { color: colors.muted }]} numberOfLines={1}>{value}</Text> : null}
        {trailing ?? (onPress ? <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={20} color={colors.muted} /> : null)}
      </View>
    </>
  );
  return (
    <View style={styles.row}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          style={styles.head}
          accessibilityRole="button"
          accessibilityLabel={value ? `${label}, ${value}` : label}
          accessibilityState={children !== undefined ? { expanded: !!open } : undefined}
        >
          {head}
        </Pressable>
      ) : (
        <View style={styles.head} accessible accessibilityLabel={value ? `${label}, ${value}` : label}>{head}</View>
      )}
      {open && children ? <Appear style={styles.body}>{children}</Appear> : null}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    rows: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faint },
    row: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.faint },
    head: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
    right: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs },
    value: { flexShrink: 1, fontVariant: ['tabular-nums'] },
    body: { paddingBottom: space.lg, gap: space.md },
  });
