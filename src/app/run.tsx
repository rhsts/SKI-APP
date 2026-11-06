import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Stack from 'expo-router/stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ElevationChart } from '../components/ElevationChart';
import { RouteMap } from '../components/RouteMap';
import { SpeedChart } from '../components/SpeedChart';
import { StatGrid, StatTile } from '../components/StatTile';
import { getPoints, getSession, type SessionRow } from '../db';
import { fmtAlt, fmtClock, fmtDist, fmtSpeed, fmtTimeOfDay } from '../lib/format';
import { difficultyColor, difficultyLabel } from '../lib/pistes';
import { runDetail } from '../lib/rundetail';
import { cleanTrack, computeStats, smoothedAltitudes, smoothedSpeeds } from '../lib/stats';
import type { TrackPoint } from '../lib/types';
import { useSettings } from '../settings';
import { useStyles, useTheme, type Palette } from '../theme';

/** One run up close: map, speed and elevation over the run, steepness, and prev/next. */
export default function RunScreen() {
  const { session: sessionId, i } = useLocalSearchParams<{ session: string; i: string }>();
  const { colors, s, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const { units } = useSettings();
  // Hint and readout share one box that keeps its tallest height, so the graph below never moves.
  const { fontScale } = useWindowDimensions();
  const [readoutH, setReadoutH] = useState(0);
  const [session, setSession] = useState<SessionRow | null>(null);
  const [raw, setRaw] = useState<TrackPoint[] | null>(null);
  // The cursor belongs to one run: after Previous / Next it starts empty again.
  const [cursorAt, setCursorAt] = useState<{ run: string; at: number } | null>(null);
  const cursor = cursorAt?.run === i ? cursorAt.at : null;
  const setCursor = useCallback((at: number) => setCursorAt({ run: i, at }), [i]);
  // No page scrolling while a finger is on the graph (Android would take the gesture over).
  const [scrubbing, setScrubbing] = useState(false);
  const onScrubStart = useCallback(() => setScrubbing(true), []);
  const onScrubEnd = useCallback(() => setScrubbing(false), []);

  useEffect(() => {
    getSession(sessionId).then(setSession);
    getPoints(sessionId).then(setRaw);
  }, [sessionId]);

  const day = useMemo(() => {
    if (!raw) return null;
    const pts = cleanTrack(raw);
    return { pts, speeds: smoothedSpeeds(pts), alts: smoothedAltitudes(pts), stats: computeStats(raw) };
  }, [raw]);

  const index = Number(i);
  const run = day?.stats.activities[index];
  const runIndices = useMemo(
    () => (day ? day.stats.activities.map((a, k) => (a.kind === 'run' ? k : -1)).filter((k) => k >= 0) : []),
    [day],
  );

  // Everything below is sliced to this run, so indices start at 0.
  const slice = useMemo(() => {
    if (!day || !run || run.kind !== 'run') return null;
    const a = run.startIndex, b = run.endIndex + 1;
    const pts = day.pts.slice(a, b);
    return {
      pts,
      times: pts.map((p) => p.t),
      speeds: day.speeds.slice(a, b),
      alts: day.alts.slice(a, b),
      // One array object per run, so the map and graph don't redraw on every drag.
      activities: [{ ...run, startIndex: 0, endIndex: pts.length - 1 }],
      detail: runDetail(day.pts, day.alts, day.speeds, run),
    };
  }, [day, run]);

  if (!session || !day) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;
  if (!run || !slice) return <Text style={[s.muted, { padding: 24 }]}>This run isn’t there any more.</Text>;

  const pos = runIndices.indexOf(index);
  const number = pos + 1;
  const piste = session.pistes?.[String(run.startTime)];
  const go = (k: number) => router.replace({ pathname: '/run', params: { session: sessionId, i: String(k) } });
  const cur = cursor != null ? slice.pts[cursor] : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content} scrollEnabled={!scrubbing}>
      <Stack.Screen options={{ title: `Run ${number} of ${runIndices.length}` }} />

      {piste ? (
        <View style={styles.pisteRow}>
          <View style={[styles.dot, { backgroundColor: difficultyColor(piste.difficulty, dark) }]} />
          <Text style={[s.h2, { flexShrink: 1 }]} numberOfLines={1}>{piste.name ?? difficultyLabel(piste.difficulty)}</Text>
          {piste.name && difficultyLabel(piste.difficulty) ? <Text style={s.muted}>{difficultyLabel(piste.difficulty)}</Text> : null}
        </View>
      ) : null}
      <Text style={s.muted}>{fmtTimeOfDay(run.startTime)} – {fmtTimeOfDay(run.endTime)} · {fmtClock(run.duration)}</Text>

      <RouteMap points={slice.pts} speeds={slice.speeds} activities={slice.activities} cursor={cursor} />

      <View style={[s.card, { gap: 10 }]}>
        <Text
          style={[s.body, { lineHeight: 20, minHeight: Math.max(20 * fontScale, readoutH) }]}
          onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > readoutH) setReadoutH(h); }}
        >
          {cur ? `${fmtTimeOfDay(cur.t)} · ${fmtSpeed(slice.speeds[cursor!] ?? 0, units)} · ${fmtAlt(slice.alts[cursor!], units)}` : 'Drag on the graph to follow the run'}
        </Text>
        <ElevationChart
          times={slice.times}
          alts={slice.alts}
          speeds={slice.speeds}
          activities={slice.activities}
          cursor={cursor}
          units={units}
          onScrubStart={onScrubStart}
          onScrub={setCursor}
          onScrubEnd={onScrubEnd}
        />
        <SpeedChart times={slice.times} speeds={slice.speeds} cursor={cursor} units={units} />
      </View>

      <StatGrid>
        <StatTile label="Top speed" value={fmtSpeed(run.topSpeed, units)} sub={`at ${fmtTimeOfDay(day.pts[slice.detail.topSpeedAt].t)}`} />
        <StatTile label="Average speed" value={fmtSpeed(run.avgSpeed, units)} />
        <StatTile label="Vertical" value={fmtAlt(run.verticalDown, units)} />
        <StatTile label="Distance" value={fmtDist(run.distance, units)} />
        <StatTile label="Average slope" value={`${slice.detail.avgSlopeDeg.toFixed(0)}°`} />
        <StatTile label="Steepest part" value={`${slice.detail.maxSlopeDeg.toFixed(0)}°`} sub="over 30 m" />
      </StatGrid>

      <View style={styles.nav}>
        <Pressable disabled={pos <= 0} onPress={() => go(runIndices[pos - 1])} style={[styles.navBtn, pos <= 0 && { opacity: 0.35 }]}>
          <Ionicons name="chevron-back" size={20} color={colors.accent} />
          <Text style={styles.navText}>Previous run</Text>
        </Pressable>
        <Pressable disabled={pos >= runIndices.length - 1} onPress={() => go(runIndices[pos + 1])} style={[styles.navBtn, pos >= runIndices.length - 1 && { opacity: 0.35 }]}>
          <Text style={styles.navText}>Next run</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.accent} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    pisteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.faint },
    nav: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    navBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent },
    navText: { color: colors.accent, fontWeight: '800' },
  });
