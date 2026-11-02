import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { fmtAlt } from '../lib/format';
import type { Activity, Units } from '../lib/types';
import { colors, s } from '../theme';

interface Props {
  times: number[];
  alts: (number | null)[];
  activities: Activity[];
  cursor?: number | null;
  units: Units;
  height?: number;
}

/** Altitude over the day; runs shaded so you can see the rhythm of lifts and runs. */
export function ElevationChart({ times, alts, activities, cursor, units, height = 120 }: Props) {
  const [width, setWidth] = useState(0);
  const pad = 4;

  const model = useMemo(() => {
    const valid = alts.filter((a): a is number => a != null);
    if (!valid.length || times.length < 2 || width === 0) return null;
    const lo = Math.min(...valid), hi = Math.max(...valid);
    const span = Math.max(hi - lo, 20);
    const t0 = times[0], t1 = times[times.length - 1];
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * width;
    const y = (a: number) => pad + (1 - (a - lo) / span) * (height - pad * 2);
    const step = Math.max(1, Math.floor(times.length / (width * 1.5)));
    let d = '';
    for (let i = 0; i < times.length; i += step) {
      const a = alts[i];
      if (a == null) continue;
      d += `${d ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(a).toFixed(1)}`;
    }
    const fill = `${d}L${width},${height}L0,${height}Z`;
    return { d, fill, x, y, lo, hi };
  }, [times, alts, width, height]);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.legend}>
        <Text style={s.label}>Elevation</Text>
        {model ? <Text style={s.muted}>{fmtAlt(model.lo, units)} – {fmtAlt(model.hi, units)}</Text> : null}
      </View>
      <Svg width="100%" height={height}>
        {model ? (
          <>
            {activities.filter((a) => a.kind === 'run').map((a) => (
              <Rect
                key={a.startIndex}
                x={model.x(a.startTime)}
                y={0}
                width={Math.max(1, model.x(a.endTime) - model.x(a.startTime))}
                height={height}
                fill={colors.accentSoft}
              />
            ))}
            <Path d={model.fill} fill="rgba(11,107,203,0.10)" />
            <Path d={model.d} stroke={colors.accent} strokeWidth={2} fill="none" />
            {cursor != null && times[cursor] != null ? (
              <Line x1={model.x(times[cursor])} x2={model.x(times[cursor])} y1={0} y2={height} stroke={colors.text} strokeWidth={1.5} />
            ) : null}
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
});
