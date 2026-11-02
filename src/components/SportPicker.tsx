import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SPORTS, type Sport } from '../lib/sport';
import { useStyles, useTheme, type Palette } from '../theme';

/** A row of chips: Ski, Snowboard, Telemark, Sit-ski, Ski touring. */
export function SportPicker({ value, onChange }: { value: Sport; onChange: (s: Sport) => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {SPORTS.map((sp) => {
        const on = sp.id === value;
        return (
          <Pressable
            key={sp.id}
            onPress={() => onChange(sp.id)}
            style={[styles.chip, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.text, on && { color: colors.onAccent }]}>{sp.emoji} {sp.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, borderColor: colors.faint, backgroundColor: colors.card },
    text: { fontWeight: '700', color: colors.text, fontSize: 15 },
  });
