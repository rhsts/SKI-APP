import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { useSettings } from './settings';

export interface Palette {
  bg: string;
  card: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  /** Text/icons on top of `accent`. */
  onAccent: string;
  accentSoft: string;
  run: string;
  lift: string;
  liftSoft: string;
  other: string;
  danger: string;
  good: string;
  warn: string;
  warnSoft: string;
  /** Dark race / highlight cards. */
  ink: string;
  onInk: string;
  onInkMuted: string;
}

// Neutral greys with a slight blue tint; `accent` is the only brand colour.
export const LIGHT: Palette = {
  bg: '#F6F7F9',
  card: '#FFFFFF',
  text: '#10141C',
  muted: '#667085',
  faint: '#E6E8EC',
  accent: '#2458E0',
  onAccent: '#FFFFFF',
  accentSoft: '#EEF3FE',
  run: '#2458E0',
  lift: '#8A93A3',
  liftSoft: '#F0F1F4',
  other: '#C2C7D0',
  danger: '#D0342C',
  good: '#1A8F4C',
  warn: '#B7740B',
  warnSoft: '#FFF6E5',
  ink: '#10141C',
  onInk: '#FFFFFF',
  onInkMuted: '#A9B0BD',
};

export const DARK: Palette = {
  bg: '#0B0D12',
  card: '#14171E',
  text: '#F1F3F7',
  muted: '#949CAB',
  faint: '#252A34',
  accent: '#7BA2FF',
  onAccent: '#0B0D12',
  accentSoft: '#18233F',
  run: '#7BA2FF',
  lift: '#8A93A3',
  liftSoft: '#1C2029',
  other: '#586070',
  danger: '#F0645C',
  good: '#3CC27A',
  warn: '#E8A33C',
  warnSoft: '#33280F',
  ink: '#1C212B',
  onInk: '#FFFFFF',
  onInkMuted: '#A9B0BD',
};

export type ThemePref = 'system' | 'light' | 'dark';

function makeBase(colors: Palette, dark: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    // Hairline border carries the edge; the shadow is only a hint of lift.
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.faint,
      shadowColor: '#10141C',
      shadowOpacity: dark ? 0 : 0.04,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 1 },
    },
    h1: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5, color: colors.text },
    h2: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, color: colors.text },
    label: { fontSize: 12, fontWeight: '500', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
    body: { fontSize: 15, lineHeight: 22, color: colors.text },
    muted: { fontSize: 13, lineHeight: 18, color: colors.muted },
  });
}

export interface Theme {
  dark: boolean;
  colors: Palette;
  s: ReturnType<typeof makeBase>;
}

const LIGHT_THEME: Theme = { dark: false, colors: LIGHT, s: makeBase(LIGHT, false) };
const DARK_THEME: Theme = { dark: true, colors: DARK, s: makeBase(DARK, true) };

export function resolveTheme(pref: ThemePref, system: string | null | undefined): Theme {
  return pref === 'dark' || (pref === 'system' && system === 'dark') ? DARK_THEME : LIGHT_THEME;
}

/** Current theme: follows the phone's dark mode unless overridden in Profile. */
export function useTheme(): Theme {
  const { theme } = useSettings();
  const system = useColorScheme();
  return resolveTheme(theme, system);
}

/** Component styles that depend on the theme: `const styles = useStyles(makeStyles)`. */
export function useStyles<T>(factory: (colors: Palette, dark: boolean) => T): T {
  const t = useTheme();
  return useMemo(() => factory(t.colors, t.dark), [factory, t]);
}

/** Speed → colour for map lines: blue (slow) → green → yellow → red (fast). */
export function speedColor(mps: number): string {
  const kmh = mps * 3.6;
  const stops: [number, [number, number, number]][] = [
    [0, [40, 110, 220]],
    [25, [30, 170, 110]],
    [45, [240, 190, 30]],
    [65, [220, 50, 40]],
  ];
  if (kmh <= stops[0][0]) return rgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (kmh <= stops[i][0]) {
      const [k0, c0] = stops[i - 1];
      const [k1, c1] = stops[i];
      const u = (kmh - k0) / (k1 - k0);
      return rgb([0, 1, 2].map((j) => c0[j] + u * (c1[j] - c0[j])) as [number, number, number]);
    }
  }
  return rgb(stops[stops.length - 1][1]);
}

function rgb([r, g, b]: [number, number, number]) {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
