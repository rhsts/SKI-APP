import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { fmtAlt, fmtSpeed, fmtTimeOfDay } from '../lib/format';
import { activityAt, indexAtX } from '../lib/scrub';
import type { Activity, Units } from '../lib/types';
import { useTheme, useStyles, type Palette } from '../theme';

interface Props {
  times: number[];
  alts: (number | null)[];
  speeds: number[];
  activities: Activity[];
  cursor?: number | null;
  units: Units;
  height?: number;
  /** Finger touched the graph (e.g. pause the replay). */
  onScrubStart?: () => void;
  /** Finger moved to this track index. */
  onScrub?: (index: number) => void;
}

const LABEL_H = 22;

/**
 * Altitude over the day, runs shaded. It doubles as the replay control:
 * drag along it to move through the day.
 */
export function ElevationChart({
  times, alts, speeds, activities, cursor, units, height = 140, onScrubStart, onScrub,
}: Props) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const pad = 6;
  const plotTop = LABEL_H;
  const plotH = height - LABEL_H;

  const scrubTo = (e: GestureResponderEvent) => {
    const i = indexAtX(times, e.nativeEvent.locationX, width);
    if (i >= 0) onScrub?.(i);
  };

  const model = useMemo(() => {
    const valid = alts.filter((a): a is number => a != null);
    if (!valid.length || times.length < 2 || width === 0) return null;
    const lo = Math.min(...valid), hi = Math.max(...valid);
    const span = Math.max(hi - lo, 20);
    const t0 = times[0], t1 = times[times.length - 1];
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * width;
    const y = (a: number) => plotTop + pad + (1 - (a - lo) / span) * (plotH - pad * 2);
    const step = Math.max(1, Math.floor(times.length / (width * 1.5)));
    let d = '';
    for (let i = 0; i < times.length; i += step) {
      const a = alts[i];
      if (a == null) continue;
      d += `${d ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(a).toFixed(1)}`;
    }
    const fill = `${d}L${width},${height}L0,${height}Z`;
    return { d, fill, x, y, lo, hi };
  }, [times, alts, width, height, plotTop, plotH]);

  const c = cursor != null && cursor >= 0 && cursor < times.length ? cursor : null;
  const cx = model && c != null ? model.x(times[c]) : null;
  const cy = model && c != null && alts[c] != null ? model.y(alts[c] as number) : null;
  const act = c != null ? activityAt(activities, c) : null;
  // Speed only means something on a run: lifts and breaks show time and altitude only.
  const label = c != null
    ? [
        fmtTimeOfDay(times[c]),
        act?.kind === 'run' ? fmtSpeed(speeds[c] ?? 0, units) : act?.kind === 'lift' ? 'Lift' : null,
        fmtAlt(alts[c], units),
      ].filter(Boolean).join(' · ')
    : null;
  const labelW = 190;
  const labelLeft = cx != null ? Math.max(0, Math.min(width - labelW, cx - labelW / 2)) : 0;

  return (
    <View>
      <View style={styles.legend}>
        <Text style={s.label}>Elevation</Text>
        {model ? <Text style={s.muted}>{fmtAlt(model.lo, units)} – {fmtAlt(model.hi, units)}</Text> : null}
      </View>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // Keep the gesture: otherwise the page's ScrollView takes over mid-drag.
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          onScrubStart?.();
          scrubTo(e);
        }}
        onResponderMove={scrubTo}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Replay position. Drag along the graph to move through the day."
      >
        <Svg width="100%" height={height} pointerEvents="none">
          {model ? (
            <>
              {activities.filter((a) => a.kind === 'run').map((a) => (
                <Rect
                  key={a.startIndex}
                  x={model.x(a.startTime)}
                  y={plotTop}
                  width={Math.max(1, model.x(a.endTime) - model.x(a.startTime))}
                  height={plotH}
                  fill={colors.accentSoft}
                />
              ))}
              <Path d={model.fill} fill="rgba(11,107,203,0.10)" />
              <Path d={model.d} stroke={colors.accent} strokeWidth={2} fill="none" />
              {cx != null ? (
                <>
                  <Line x1={cx} x2={cx} y1={plotTop} y2={height} stroke={colors.text} strokeWidth={1.5} />
                  {cy != null ? <Circle cx={cx} cy={cy} r={7} fill={colors.accent} stroke={colors.card} strokeWidth={3} /> : null}
                </>
              ) : null}
            </>
          ) : null}
        </Svg>
        {label && cx != null ? (
          <View pointerEvents="none" style={[styles.bubble, { left: labelLeft, width: labelW }]}>
            <Text style={styles.bubbleText} numberOfLines={1}>{label}</Text>
          </View>
        ) : (
          <View pointerEvents="none" style={styles.hintWrap}>
            <Text style={styles.hint}>Drag on the graph to replay</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    legend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
    bubble: { position: 'absolute', top: 0, height: LABEL_H - 4, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: colors.ink },
    bubbleText: { color: colors.onInk, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
    hintWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
    hint: { fontSize: 12, fontWeight: '600', color: colors.muted },
  });
