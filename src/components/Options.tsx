import { Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic } from '../haptics';
import { space, target, useTheme } from '../theme';

interface Props<T extends string> {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** Read out for the whole group, e.g. "Units". */
  label?: string;
}

/** Pick one of a few: plain words, the chosen one in the text colour with a glacier underline. */
export function Options<T extends string>({ options, value, onChange, label }: Props<T>) {
  const { colors, s } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => {
              if (!on) haptic('select');
              onChange(o.id);
            }}
            style={styles.option}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            <Text style={[on ? s.control : s.body, !on && { color: colors.muted }]}>{o.label}</Text>
            <View style={[styles.mark, on && { backgroundColor: colors.ice }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.xl },
  option: { minHeight: target.min, justifyContent: 'center', gap: space.xs },
  mark: { height: 2 },
});
