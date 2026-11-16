import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '../haptics';
import type { Units } from '../lib/types';
import { updateSettings, useSettings } from '../settings';
import { radius, space, target, useStyles, useTheme, type Palette, type ThemePref } from '../theme';
import { Options } from './Options';
import { SportPicker } from './SportPicker';
import { Tap } from './Tap';

const UNITS: { id: Units; label: string }[] = [
  { id: 'metric', label: 'Metric (km/h, m)' },
  { id: 'imperial', label: 'Imperial (mph, ft)' },
];
const LOOKS: { id: ThemePref; label: string }[] = [
  { id: 'system', label: 'Follow the phone' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/**
 * Shown once, the first time the app opens: the few choices that change what you see
 * and feel on the mountain. Every one of them can be changed later under You.
 */
export function Setup() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const st = useSettings();

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, space.lg) + space.lg }]} bounces={false}>
        <View style={styles.head}>
          <Text style={s.label}>Welcome</Text>
          <Text style={s.h1} accessibilityRole="header">Set up Ski Tracker</Text>
          <Text style={s.body}>You can change these later under You.</Text>
        </View>

        <View style={styles.group}>
          <Text style={s.label}>Units</Text>
          <Options options={UNITS} value={st.units} onChange={(units) => updateSettings({ units })} label="Units" />
        </View>
        <View style={styles.group}>
          <Text style={s.label}>Sport</Text>
          <SportPicker value={st.sport} onChange={(sport) => updateSettings({ sport })} />
        </View>
        <View style={styles.group}>
          <Text style={s.label}>Look</Text>
          <Options options={LOOKS} value={st.theme} onChange={(theme) => updateSettings({ theme })} label="Look" />
        </View>

        <View style={styles.group}>
          <Toggle
            label="Vibrate"
            hint="At the end of a run and on a new top speed."
            value={st.vibrate}
            onChange={(vibrate) => updateSettings({ vibrate })}
          />
          <Toggle
            label="Jumps and falls"
            hint="Counted while the app is on screen."
            value={st.motion}
            onChange={(motion) => updateSettings({ motion })}
          />
          <Toggle
            label="Fall check"
            hint="No answer after a hard fall opens SOS."
            value={st.fallCheck && st.motion}
            disabled={!st.motion}
            onChange={(fallCheck) => updateSettings({ fallCheck })}
          />
        </View>

        <View style={styles.spacer} />
        <Tap
          onPress={() => {
            haptic('select');
            updateSettings({ setupDone: true });
          }}
          style={styles.done}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={[s.control, { color: colors.bg }]}>Done</Text>
        </Tap>
      </ScrollView>
    </View>
  );
}

function Toggle({ label, hint, value, disabled, onChange }: { label: string; hint: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.toggle}>
      <View style={styles.grow}>
        <Text style={s.body}>{label}</Text>
        <Text style={s.muted}>{hint}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors.accent }}
        // Android tints the thumb with its own blue: keep it in the palette.
        thumbColor={Platform.OS === 'android' ? (value ? colors.onAccent : colors.card) : undefined}
        accessibilityLabel={label}
      />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { backgroundColor: colors.bg },
    content: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.xl },
    head: { gap: space.xs },
    group: { gap: space.xs, paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faint },
    toggle: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: 64 },
    grow: { flex: 1 },
    spacer: { flexGrow: 1 },
    done: { height: target.control, borderRadius: radius.card, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  });
