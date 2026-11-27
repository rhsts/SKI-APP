import { useMemo, type ComponentRef, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { fmtAlt, fmtDate, fmtDist, fmtDuration, fmtSpeed } from '../lib/format';
import { localProjector } from '../lib/geo';
import type { Activity, DayStats, TrackPoint, Units } from '../lib/types';
import { font, LIGHT, size, space, speedColor } from '../theme';

interface Props {
  points: TrackPoint[]; // cleaned
  speeds: number[];
  stats: DayStats;
  place: string | null;
  startedAt: number;
  units: Units;
  /** For capturing the card as an image. */
  ref?: Ref<ComponentRef<typeof View>>;
}

export const CARD_W = 360;
export const CARD_H = 450; // 4:5, the shape Instagram and WhatsApp status like

const MAP_H = 136;
const PAD = space.xl;

/**
 * A poster of your day to share as an image. Fixed snow-white design (independent of
 * the app theme) so it looks the same wherever it's posted. The route is drawn
 * in SVG instead of using the map, which can't be captured reliably on Android.
 */
export function DayShareCard({ points, speeds, stats, place, startedAt, units, ref }: Props) {
  const lines = useMemo(() => buildLines(points, speeds, stats.activities), [points, speeds, stats.activities]);

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View style={styles.head}>
        <Text allowFontScaling={false} style={styles.title} numberOfLines={1}>{place ?? 'Ski day'}</Text>
        <Text allowFontScaling={false} style={styles.caption}>{fmtDate(startedAt)}</Text>
      </View>

      {/* Fast is deep glacier, slow is pale ice: the same ramp as the app's maps, on snow white. */}
      <View style={styles.map}>
        <Svg width={CARD_W - 2 * PAD} height={MAP_H}>
          {lines.map((l, i) => (
            <Polyline
              key={i}
              points={l.points}
              fill="none"
              stroke={l.color}
              strokeWidth={l.lift ? 1.5 : 3.5}
              strokeDasharray={l.lift ? '5,4' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      </View>

      <View style={styles.hero}>
        <Text allowFontScaling={false} style={styles.caption}>Vertical</Text>
        <View style={styles.heroRow}>
          <Text allowFontScaling={false} style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
            {fmtAlt(stats.verticalDown, units, false)}
          </Text>
          <Text allowFontScaling={false} style={styles.unit}>{units === 'metric' ? 'm' : 'ft'}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        <Small label="Top speed" value={fmtSpeed(stats.topSpeed, units)} />
        <Small label="Runs" value={String(stats.runCount)} />
        <Small label="Ski time" value={fmtDuration(stats.skiTime)} />
      </View>
      <View style={styles.grid}>
        <Small label="Distance" value={fmtDist(stats.skiDistance, units)} />
        <Small label="Peak" value={fmtAlt(stats.maxAlt, units)} />
        <View style={styles.cell}>
          <Text allowFontScaling={false} style={[styles.caption, styles.brand]}>Ski Tracker</Text>
        </View>
      </View>
    </View>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text allowFontScaling={false} style={styles.caption}>{label}</Text>
      <Text allowFontScaling={false} style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

interface Line {
  points: string;
  color: string;
  lift: boolean;
}

/** Fits the day into the map box: lifts as dashed lines, runs in short pieces coloured by speed. */
function buildLines(points: TrackPoint[], speeds: number[], activities: Activity[]): Line[] {
  if (points.length < 2) return [];
  const { toXY } = localProjector(points[0]);
  const xy = points.map(toXY);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of xy) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const w = CARD_W - 2 * PAD, h = MAP_H, m = 8;
  const scale = Math.min((w - 2 * m) / Math.max(maxX - minX, 1), (h - 2 * m) / Math.max(maxY - minY, 1));
  const ox = (w - (maxX - minX) * scale) / 2, oy = (h - (maxY - minY) * scale) / 2;
  const sx = (i: number) => (ox + (xy[i].x - minX) * scale).toFixed(1);
  const sy = (i: number) => (oy + (maxY - xy[i].y) * scale).toFixed(1); // north up
  const pts = (from: number, to: number, step: number) => {
    const out: string[] = [];
    for (let i = from; i < to; i += step) out.push(`${sx(i)},${sy(i)}`);
    out.push(`${sx(to)},${sy(to)}`);
    return out.join(' ');
  };

  const lines: Line[] = [];
  const step = Math.max(1, Math.floor(points.length / 1500));
  for (const a of activities) {
    if (a.kind === 'lift') lines.push({ points: pts(a.startIndex, a.endIndex, step * 3), color: LIGHT.lift, lift: true });
    if (a.kind !== 'run') continue;
    const chunk = Math.max(step * 2, 6);
    for (let i = a.startIndex; i < a.endIndex; i += chunk) {
      const end = Math.min(a.endIndex, i + chunk);
      let v = 0;
      for (let k = i; k <= end; k++) v += speeds[k] ?? 0;
      lines.push({ points: pts(i, end, step), color: speedColor(v / (end - i + 1)), lift: false });
    }
  }
  return lines;
}

const styles = StyleSheet.create({
  // No borderRadius: this view is captured to PNG and rounded corners would come out transparent.
  card: { width: CARD_W, height: CARD_H, overflow: 'hidden', backgroundColor: LIGHT.bg, padding: PAD, gap: space.lg },
  head: { gap: 2 },
  title: { color: LIGHT.text, fontSize: size.figure, lineHeight: 32, letterSpacing: -0.5, fontFamily: font.medium },
  caption: { color: LIGHT.muted, fontSize: size.caption, lineHeight: 18, fontFamily: font.medium },
  map: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: LIGHT.faint },
  hero: { marginTop: -space.xs },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  heroValue: { color: LIGHT.text, fontSize: 56, lineHeight: 62, letterSpacing: -1.5, fontFamily: font.light, fontVariant: ['tabular-nums'], flexShrink: 1 },
  unit: { color: LIGHT.muted, fontSize: size.control, fontFamily: font.regular },
  grid: { flexDirection: 'row', marginTop: -space.sm },
  cell: { width: '33.33%', gap: 2 },
  value: { color: LIGHT.text, fontSize: size.control, lineHeight: 26, fontFamily: font.regular, fontVariant: ['tabular-nums'] },
  brand: { textAlign: 'right', marginTop: 'auto' },
});
