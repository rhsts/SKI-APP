import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { useSettings } from './settings';

export interface Palette {
  bg: string;
  card: string;
  text: string;
  muted: string;
  /** Hairlines, and the tonal fill of quiet controls. */
  faint: string;
  /** Deep glacier: safe for text, icons and filled controls. */
  accent: string;
  /** Text/icons on top of `accent`. */
  onAccent: string;
  accentSoft: string;
  /** Light glacier: rings, underlines and marks only. Too pale for text. */
  ice: string;
  run: string;
  lift: string;
  liftSoft: string;
  other: string;
  /** SOS and the fall check only. */
  danger: string;
  good: string;
  warn: string;
  warnSoft: string;
  /** Dark race / highlight cards. */
  ink: string;
  onInk: string;
  onInkMuted: string;
  /** Floating chrome (tab bar) on top of a blur. */
  glass: string;
}

// "Alpine dawn": warm snow white and warm graphite, with glacier ice as the only brand colour.
export const LIGHT: Palette = {
  bg: '#F7F5F1',
  card: '#FDFCFA',
  text: '#1A1917',
  muted: '#54514B',
  faint: '#E2DED6',
  accent: '#2F5561',
  onAccent: '#FFFFFF',
  accentSoft: '#E7EFF1',
  ice: '#9FC3CF',
  run: '#2F5561',
  lift: '#8C877E',
  liftSoft: '#EFECE6',
  other: '#CBC6BC',
  danger: '#923127',
  good: '#3F7A5A',
  warn: '#8A6418',
  warnSoft: '#F4EDDC',
  ink: '#1A1917',
  onInk: '#F7F5F1',
  onInkMuted: '#A8A39A',
  glass: 'rgba(253,252,250,0.72)',
};

export const DARK: Palette = {
  bg: '#0F0E0D',
  card: '#191816',
  text: '#EFEBE4',
  muted: '#A8A39A',
  faint: '#2B2926',
  accent: '#A9CBD6',
  onAccent: '#0F0E0D',
  accentSoft: '#1A282C',
  ice: '#9FC3CF',
  run: '#A9CBD6',
  lift: '#8C877E',
  liftSoft: '#1F1D1B',
  other: '#57534D',
  danger: '#E08277',
  good: '#6FA588',
  warn: '#D4A857',
  warnSoft: '#2B2415',
  ink: '#23211F',
  onInk: '#EFEBE4',
  onInkMuted: '#A8A39A',
  glass: 'rgba(25,24,22,0.72)',
};

export type ThemePref = 'system' | 'light' | 'dark';

/** Inter, loaded in the root layout. One family per face: never combine with `fontWeight`. */
export const font = { light: 'Inter_300Light', regular: 'Inter_400Regular', medium: 'Inter_500Medium' } as const;

/** The only type sizes (1.25 scale). `hero` shrinks to `heroFit` for long values. */
export const size = { label: 11, caption: 13, body: 16, control: 20, figure: 25, heroFit: 96, hero: 120 } as const;

/** The only gaps. Related things sit 4–8 apart, groups 24 apart. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** One radius for controls, cards and sheets; floating chrome is a pill. */
export const radius = { card: 24, pill: 999 } as const;

/** Touch targets: the minimum everywhere, and the glove-sized Record controls. */
export const target = { min: 44, control: 72, start: 144 } as const;

/** Durations in ms. Leaving is quicker than arriving; everything eases out. */
export const motion = {
  press: 120,
  micro: 180,
  enter: 220,
  exit: 140,
  screen: 360,
  roll: 500,
  hold: 1000,
  /** Cubic bezier for `Easing.bezier(...)`. */
  easeOut: [0.2, 0, 0, 1],
  /** Sheets and cards: critically damped, no overshoot. */
  spring: { damping: 32, stiffness: 240, mass: 1 },
} as const;

/** Floating chrome only: two soft layers instead of one dark blur. Content has no shadow. */
export const chromeShadow = (dark: boolean) =>
  dark ? '0 1 2 rgba(0,0,0,0.4), 0 8 24 rgba(0,0,0,0.35)' : '0 1 2 rgba(26,25,23,0.05), 0 8 24 rgba(26,25,23,0.06)';

function makeBase(colors: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    // A hairline carries the edge: no shadow on content.
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: space.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.faint,
    },
    // Hierarchy comes from weight and colour more than from size.
    h1: { fontFamily: font.medium, fontSize: size.figure, lineHeight: 32, letterSpacing: -0.5, color: colors.text },
    h2: { fontFamily: font.medium, fontSize: size.body, lineHeight: 24, color: colors.text },
    label: { fontFamily: font.medium, fontSize: size.label, lineHeight: 16, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.1 },
    body: { fontFamily: font.regular, fontSize: size.body, lineHeight: 24, color: colors.text },
    muted: { fontFamily: font.regular, fontSize: size.caption, lineHeight: 18, color: colors.muted },
    /** A number: 4,984 or 78.4. Its unit goes beside it in `muted`. */
    figure: { fontFamily: font.regular, fontSize: size.figure, lineHeight: 32, letterSpacing: -0.5, color: colors.text, fontVariant: ['tabular-nums'] },
    /** Text on buttons. */
    control: { fontFamily: font.medium, fontSize: size.body, lineHeight: 24, color: colors.text },
    hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.faint },
  });
}

export interface Theme {
  dark: boolean;
  colors: Palette;
  s: ReturnType<typeof makeBase>;
}

const LIGHT_THEME: Theme = { dark: false, colors: LIGHT, s: makeBase(LIGHT) };
const DARK_THEME: Theme = { dark: true, colors: DARK, s: makeBase(DARK) };

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

/** Speed → colour for map lines: one glacier ramp, pale (slow) → deep (fast). */
export function speedColor(mps: number): string {
  const kmh = mps * 3.6;
  const stops: [number, [number, number, number]][] = [
    [0, [176, 205, 214]],
    [25, [111, 160, 175]],
    [45, [47, 85, 97]],
    [65, [22, 42, 49]],
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
