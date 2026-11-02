import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { fmtSpeed } from '../lib/format';
import type { Units } from '../lib/types';
import { useStyles, useTheme, type Palette } from '../theme';

/** Speed over time for one run, with the replay cursor. */
export function SpeedChart({ times, speeds, cursor, units, height = 110 }: {
  times: number[]; speeds: number[]; cursor?: number | null; units: Units; height?: number;
}) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const model = useMemo(() => {
    if (times.length < 2 || width === 0) return null;
    const max = Math.max(...speeds, 1);
    const t0 = times[0], t1 = times[times.length - 1];
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * width;
    const y = (v: number) => 4 + (1 - v / max) * (height - 8);
    let d = '';
    times.forEach((t, i) => { d += `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(speeds[i] ?? 0).toFixed(1)}`; });
    return { d, fill: `${d}L${width},${height}L0,${height}Z`, x, max };
  }, [times, speeds, width, height]);
  const c = cursor != null && cursor >= 0 && cursor < times.length ? cursor : null;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={styles.legend}>
        <Text style={s.label}>Speed</Text>
        {model ? <Text style={s.muted}>max {fmtSpeed(model.max, units)}</Text> : null}
      </View>
      <Svg width="100%" height={height}>
        {model ? (
          <>
            <Path d={model.fill} fill="rgba(232,137,43,0.15)" />
            <Path d={model.d} stroke={colors.warn} strokeWidth={2} fill="none" />
            {c != null ? <Line x1={model.x(times[c])} x2={model.x(times[c])} y1={0} y2={height} stroke={colors.text} strokeWidth={1.5} /> : null}
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const makeStyles = (_: Palette) =>
  StyleSheet.create({
    legend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  });
