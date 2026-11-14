import { Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic } from '../haptics';
import { SPORTS, type Sport } from '../lib/sport';
import { space, target, useTheme } from '../theme';

/** Ski, Snowboard, Telemark, Sit-ski, Ski touring: plain words, the chosen one underlined. */
export function SportPicker({ value, onChange }: { value: Sport; onChange: (s: Sport) => void }) {
  const { colors, s } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {SPORTS.map((sp) => {
        const on = sp.id === value;
        return (
          <Pressable
            key={sp.id}
            onPress={() => {
              if (!on) haptic('select');
              onChange(sp.id);
            }}
            style={styles.option}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={sp.label}
          >
            <Text style={[on ? s.control : s.body, !on && { color: colors.muted }]}>{sp.label}</Text>
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
