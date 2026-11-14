import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chromeShadow, font, size, space, target, useStyles, useTheme, type Palette } from '../theme';
import { useTracker } from '../tracking/tracker';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The four tabs. `also`: routes that live under a tab without a button of their own. */
const TABS: { name: string; label: string; icon: IconName; also?: string[] }[] = [
  { name: 'index', label: 'Record', icon: 'radio-button-off' },
  { name: 'days', label: 'Days', icon: 'calendar-clear-outline' },
  { name: 'leaderboard', label: 'Friends', icon: 'people-outline', also: ['challenges'] },
  { name: 'profile', label: 'You', icon: 'person-outline', also: ['season'] },
];

const HEIGHT = 64;
const gapBelow = (safeBottom: number) => Math.max(safeBottom, space.lg);

/** Bottom padding a tab screen needs so its last content clears the floating bar. */
export function useTabBarSpace(): number {
  return gapBelow(useSafeAreaInsets().bottom) + HEIGHT + space.xl;
}

/** A floating glass pill over the content: four thin icons with small labels. */
export function TabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { colors, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const recording = useTracker().status === 'recording';
  const focused = state.routes[state.index]?.name;

  return (
    <View style={[styles.wrap, { bottom: gapBelow(insets.bottom) }]} pointerEvents="box-none">
      <View style={[styles.lift, { boxShadow: chromeShadow(dark) }]}>
        <View style={styles.bar} accessibilityRole="tablist">
          {/* Real blur on iOS. Android without a blur target would only be see-through, so it gets a solid surface. */}
          {Platform.OS === 'ios' ? <BlurView intensity={40} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} /> : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'ios' ? colors.glass : colors.card }]} />
          {TABS.map((tab) => {
            const route = state.routes.find((r) => r.name === tab.name);
            if (!route) return null;
            const here = focused === tab.name;
            const on = here || !!tab.also?.includes(focused ?? '');
            const live = tab.name === 'index' && recording;
            const color = live ? colors.accent : on ? colors.text : colors.muted;
            return (
              <Pressable
                key={tab.name}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={live ? `${tab.label}, recording` : tab.label}
                onPress={() => {
                  const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!here && !event.defaultPrevented) navigateToTab(route.key);
                }}
                onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              >
                <Ionicons name={live ? 'radio-button-on' : tab.icon} size={24} color={color} />
                <Text style={[styles.label, { color: on ? colors.text : colors.muted }]} maxFontSizeMultiplier={1.2}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: space.lg, right: space.lg },
    lift: { borderRadius: HEIGHT / 2 },
    bar: {
      height: HEIGHT, borderRadius: HEIGHT / 2, overflow: 'hidden', flexDirection: 'row',
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.faint,
    },
    tab: { flex: 1, minHeight: target.min, alignItems: 'center', justifyContent: 'center', gap: space.xs },
    label: { fontFamily: font.medium, fontSize: size.label, letterSpacing: 0.2 },
  });
