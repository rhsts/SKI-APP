import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#F3F6FA',
  card: '#FFFFFF',
  text: '#0E1B2C',
  muted: '#5C6B7E',
  faint: '#DDE4EC',
  accent: '#0B6BCB',
  accentSoft: '#E3F0FC',
  run: '#0B6BCB',
  lift: '#7A8797',
  other: '#B4BFCC',
  danger: '#D0342C',
  good: '#1F9D55',
  warn: '#C27C0E',
};

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0E1B2C',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  h1: { fontSize: 28, fontWeight: '800', color: colors.text },
  h2: { fontSize: 18, fontWeight: '700', color: colors.text },
  label: { fontSize: 12, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
});

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
