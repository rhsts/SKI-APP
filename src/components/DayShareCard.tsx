import { useMemo, type ComponentRef, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Polyline, Rect, Stop } from 'react-native-svg';
import { fmtAlt, fmtDate, fmtDist, fmtDuration, fmtSpeed } from '../lib/format';
import { localProjector } from '../lib/geo';
import type { Activity, DayStats, TrackPoint, Units } from '../lib/types';
import { speedColor } from '../theme';

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

const MAP_H = 220;
const MAP_Y = 64;
const PAD = 22;

/**
 * A poster of your day to share as an image. Fixed dark design (independent of
 * the app theme) so it looks the same wherever it's posted. The route is drawn
 * in SVG instead of using the map, which can't be captured reliably on Android.
 */
export function DayShareCard({ points, speeds, stats, place, startedAt, units, ref }: Props) {
  const lines = useMemo(() => buildLines(points, speeds, stats.activities), [points, speeds, stats.activities]);

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <Svg width={CARD_W} height={CARD_H} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B2545" />
            <Stop offset="1" stopColor="#081421" />
          </LinearGradient>
          <ClipPath id="map">
            <Rect x={PAD} y={MAP_Y} width={CARD_W - 2 * PAD} height={MAP_H} />
          </ClipPath>
        </Defs>
        <Rect x={0} y={0} width={CARD_W} height={CARD_H} fill="url(#bg)" />
        {/* A G, not a nested Svg: Android's react-native-svg ignores x/y on nested Svg. */}
        <G clipPath="url(#map)">
          <G transform={`translate(${PAD}, ${MAP_Y})`}>
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
                opacity={l.lift ? 0.6 : 1}
              />
            ))}
          </G>
        </G>
      </Svg>

      <Text allowFontScaling={false} style={styles.brand}>⛷️  SKI TRACKER</Text>
      <Text allowFontScaling={false} style={styles.title} numberOfLines={1}>{place ?? 'Ski day'}</Text>
      <Text allowFontScaling={false} style={styles.date}>{fmtDate(startedAt)}</Text>

      <View style={styles.grid}>
        <Big label="Top speed" value={fmtSpeed(stats.topSpeed, units)} />
        <Big label="Vertical" value={fmtAlt(stats.verticalDown, units)} />
        <Big label="Runs" value={String(stats.runCount)} />
        <Big label="Ski time" value={fmtDuration(stats.skiTime)} />
        <Big label="Distance" value={fmtDist(stats.skiDistance, units)} />
        <Big label="Peak" value={fmtAlt(stats.maxAlt, units)} />
      </View>
    </View>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text allowFontScaling={false} style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text allowFontScaling={false} style={styles.label}>{label}</Text>
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
    if (a.kind === 'lift') lines.push({ points: pts(a.startIndex, a.endIndex, step * 3), color: '#9FB3C8', lift: true });
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
  card: { width: CARD_W, height: CARD_H, overflow: 'hidden', backgroundColor: '#081421' },
  brand: { position: 'absolute', top: 18, left: PAD, color: '#7FB3E6', fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  title: { position: 'absolute', top: 32, left: PAD, right: PAD, color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  date: { position: 'absolute', top: 17, right: PAD, color: '#9FB3C8', fontSize: 12, fontWeight: '500' },
  grid: { position: 'absolute', left: PAD, right: PAD, bottom: PAD, flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  cell: { width: '33.33%' },
  value: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  label: { color: '#9FB3C8', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
});
