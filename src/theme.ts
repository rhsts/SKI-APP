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

export const LIGHT: Palette = {
  bg: '#F3F6FA',
  card: '#FFFFFF',
  text: '#0E1B2C',
  muted: '#5C6B7E',
  faint: '#DDE4EC',
  accent: '#0B6BCB',
  onAccent: '#FFFFFF',
  accentSoft: '#E3F0FC',
  run: '#0B6BCB',
  lift: '#7A8797',
  liftSoft: '#EEF1F4',
  other: '#B4BFCC',
  danger: '#D0342C',
  good: '#1F9D55',
  warn: '#C27C0E',
  warnSoft: '#FFF4E0',
  ink: '#0E1B2C',
  onInk: '#FFFFFF',
  onInkMuted: '#B9C4D2',
};

export const DARK: Palette = {
  bg: '#0B1420',
  card: '#14202F',
  text: '#EAF0F7',
  muted: '#9AA8B8',
  faint: '#26354A',
  accent: '#4DA3F5',
  onAccent: '#0B1420',
  accentSoft: '#15304D',
  run: '#4DA3F5',
  lift: '#8F9CAD',
  liftSoft: '#1D2A3A',
  other: '#5C6B7E',
  danger: '#F0645C',
  good: '#3CC27A',
  warn: '#E8A33C',
  warnSoft: '#3A2C14',
  ink: '#22344A',
  onInk: '#FFFFFF',
  onInkMuted: '#B9C4D2',
};

export type ThemePref = 'system' | 'light' | 'dark';

function makeBase(colors: Palette, dark: boolean) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      shadowColor: '#0E1B2C',
      shadowOpacity: dark ? 0 : 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: dark ? 0 : 1,
    },
    h1: { fontSize: 28, fontWeight: '800', color: colors.text },
    h2: { fontSize: 18, fontWeight: '700', color: colors.text },
    label: { fontSize: 12, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
    body: { fontSize: 15, color: colors.text },
    muted: { fontSize: 14, color: colors.muted },
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
