import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams, type ErrorBoundaryProps } from 'expo-router';
import Stack from 'expo-router/stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ElevationChart } from '../../components/ElevationChart';
import { RouteMap } from '../../components/RouteMap';
import { StatGrid, StatTile } from '../../components/StatTile';
import { BreakRow, TimelineCard } from '../../components/TimelineCard';
import { deleteSession, getPoints, getSession, listSegments, listSessionAttempts, renameSession, type SessionRow } from '../../db';
import type { Attempt, Segment } from '../../lib/segments';
import {
  fmtAlt, fmtDate, fmtDist, fmtDuration, fmtRaceTime, fmtSpeed, fmtTimeOfDay,
} from '../../lib/format';
import { activityAt } from '../../lib/scrub';
import { cleanTrack, computeStats, smoothedAltitudes, smoothedSpeeds } from '../../lib/stats';
import type { TrackPoint } from '../../lib/types';
import { useSettings } from '../../settings';
import { colors, s } from '../../theme';

const REPLAY_RATE = 60; // 1 minute of the day per second

export default function DayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { units } = useSettings();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [raw, setRaw] = useState<TrackPoint[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [timed, setTimed] = useState<{ attempt: Attempt; segment: Segment }[]>([]);

  useEffect(() => {
    if (!id) return;
    getSession(id).then((ses) => { setSession(ses); setName(ses?.place ?? ''); });
    getPoints(id).then(setRaw);
  }, [id]);

  // Challenge times set on this day (refreshed when coming back from creating one).
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      Promise.all([listSessionAttempts(id), listSegments()]).then(([atts, segs]) => {
        const byId = new Map(segs.map((x) => [x.id, x]));
        setTimed(atts.filter((a) => byId.has(a.segmentId)).map((a) => ({ attempt: a, segment: byId.get(a.segmentId)! })));
      });
    }, [id]),
  );

  // Recompute from raw points so indices always match the cleaned track.
  const day = useMemo(() => {
    if (!raw) return null;
    const pts = cleanTrack(raw);
    return { pts, times: pts.map((p) => p.t), speeds: smoothedSpeeds(pts), alts: smoothedAltitudes(pts), stats: computeStats(raw) };
  }, [raw]);

  // Replay: advance the cursor through time.
  const cursorRef = useRef(cursor);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  useEffect(() => {
    if (!playing || !day) return;
    const timer = setInterval(() => {
      const pts = day.pts;
      let i = cursorRef.current ?? 0;
      if (i >= pts.length - 1) { setPlaying(false); return; }
      const target = pts[i].t + (REPLAY_RATE * 1000) / 20;
      while (i < pts.length - 1 && pts[i].t < target) i++;
      cursorRef.current = i;
      setCursor(i);
    }, 50);
    return () => clearInterval(timer);
  }, [playing, day]);

  if (!session || !day) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  const { pts, times, speeds, alts, stats } = day;
  const timeline = stats.activities;
  let runNo = 0, liftNo = 0;
  const numbers = timeline.map((a) => (a.kind === 'run' ? ++runNo : a.kind === 'lift' ? ++liftNo : 0));
  const cur = cursor != null ? pts[cursor] : null;
  const curActivity = cursor != null ? activityAt(timeline, cursor) : null;
  // Speed is only shown on runs; a lift's speed isn't interesting.
  const readout = cur
    ? [
        fmtTimeOfDay(cur.t),
        curActivity?.kind === 'run' ? fmtSpeed(speeds[cursor!], units) : null,
        fmtAlt(cur.alt, units),
        curActivity?.kind === 'run' ? 'Run' : curActivity?.kind === 'lift' ? 'On lift' : null,
      ].filter(Boolean).join(' · ')
    : 'Press play, or drag on the graph';

  const remove = () =>
    Alert.alert('Delete this day?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteSession(session.id); router.back(); } },
    ]);

  const saveName = async () => {
    await renameSession(session.id, name);
    setSession({ ...session, place: name.trim() || null });
    setEditing(false);
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: fmtDate(session.startedAt),
          headerRight: () => (
            <Pressable onPress={remove} hitSlop={10} accessibilityLabel="Delete day">
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
            </Pressable>
          ),
        }}
      />

      {editing ? (
        <View style={styles.titleRow}>
          <TextInput value={name} onChangeText={setName} style={styles.input} autoFocus placeholder="Resort or place" onSubmitEditing={saveName} />
          <Pressable onPress={saveName} hitSlop={10}><Ionicons name="checkmark-circle" size={30} color={colors.accent} /></Pressable>
        </View>
      ) : (
        <Pressable style={styles.titleRow} onPress={() => setEditing(true)}>
          <Text style={[s.h1, { flex: 1 }]} numberOfLines={2}>{session.place ?? 'Ski day'}</Text>
          <Ionicons name="pencil" size={18} color={colors.muted} />
        </Pressable>
      )}
      <Text style={s.muted}>
        {fmtTimeOfDay(session.startedAt)} – {fmtTimeOfDay(session.endedAt ?? session.startedAt)} · {fmtDuration(stats.duration)} on the mountain
      </Text>

      <RouteMap points={pts} speeds={speeds} activities={timeline} cursor={cursor} focus={focus} />

      <View style={[s.card, { gap: 8 }]}>
        <View style={styles.replayRow}>
          <Pressable
            onPress={() => {
              if (!playing && (cursor == null || cursor >= pts.length - 1)) setCursor(0);
              setPlaying(!playing);
            }}
            style={styles.play}
            accessibilityLabel={playing ? 'Pause replay' : 'Play replay'}
          >
            <Ionicons name={playing ? 'pause' : 'play'} size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Replay</Text>
            <Text style={s.body}>{readout}</Text>
          </View>
        </View>
        <ElevationChart
          times={times}
          alts={alts}
          speeds={speeds}
          activities={timeline}
          cursor={cursor}
          units={units}
          onScrubStart={() => setPlaying(false)}
          onScrub={setCursor}
        />
        <SpeedLegend />
      </View>

      <StatGrid>
        <StatTile label="Top speed" value={fmtSpeed(stats.topSpeed, units)} sub={stats.topSpeedTime ? `at ${fmtTimeOfDay(stats.topSpeedTime)}` : undefined} />
        <StatTile label="Vertical ↓" value={fmtAlt(stats.verticalDown, units)} sub={`↑ ${fmtAlt(stats.verticalUp, units)}`} />
        <StatTile label="Runs" value={String(stats.runCount)} sub={`Longest ${fmtDist(stats.longestRun, units)}`} />
        <StatTile label="Ski time" value={fmtDuration(stats.skiTime)} sub={`Lifts ${fmtDuration(stats.liftTime)}`} />
        <StatTile label="Distance skied" value={fmtDist(stats.skiDistance, units)} sub={`Total ${fmtDist(stats.distance, units)}`} />
        <StatTile label="Avg ski speed" value={fmtSpeed(stats.avgSkiSpeed, units)} />
        <StatTile label="Peak altitude" value={fmtAlt(stats.maxAlt, units)} />
        <StatTile label="Lowest point" value={fmtAlt(stats.minAlt, units)} />
      </StatGrid>

      {timed.length ? (
        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.label}>Challenge times</Text>
          {timed.map(({ attempt, segment }) => (
            <Pressable key={attempt.id} onPress={() => router.push(`/segment/${segment.id}`)} style={styles.timedRow}>
              <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>🏁 {segment.name}</Text>
              <Text style={s.muted}>{fmtTimeOfDay(attempt.at)}</Text>
              <Text style={[s.body, { fontWeight: '800', minWidth: 64, textAlign: 'right' }]}>{fmtRaceTime(attempt.time)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={[s.h2, { marginTop: 8 }]}>Timeline</Text>
      <Text style={s.muted}>Tap 🏳 on a run to turn it into a challenge for your friends.</Text>
      {timeline.length === 0 ? <Text style={s.muted}>No runs or lifts detected.</Text> : null}
      {timeline.map((a, i) =>
        a.kind === 'other' ? (
          a.duration >= 120 ? <BreakRow key={i} activity={a} /> : null
        ) : (
          <TimelineCard
            key={i}
            activity={a}
            number={numbers[i]}
            units={units}
            selected={focus === i}
            onChallenge={() => router.push({ pathname: '/segment/new', params: { session: session.id, run: String(i) } })}
            onPress={() => {
              const next = focus === i ? null : i;
              setFocus(next);
              setPlaying(false);
              setCursor(next == null ? null : a.startIndex);
            }}
          />
        ),
      )}
    </ScrollView>
  );
}

/** Shown instead of closing the app if something on this screen throws. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={[s.screen, { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }]}>
      <Ionicons name="alert-circle-outline" size={44} color={colors.danger} />
      <Text style={[s.h2, { textAlign: 'center' }]}>Something went wrong showing this day</Text>
      <Text style={[s.muted, { textAlign: 'center' }]}>{error.message}</Text>
      <Pressable onPress={retry} style={styles.play}>
        <Ionicons name="refresh" size={22} color="#fff" />
      </Pressable>
    </View>
  );
}

function SpeedLegend() {
  return (
    <View style={styles.legend}>
      <Text style={s.muted}>Slow</Text>
      {['rgb(40,110,220)', 'rgb(30,170,110)', 'rgb(240,190,30)', 'rgb(220,50,40)'].map((c) => (
        <View key={c} style={[styles.swatch, { backgroundColor: c }]} />
      ))}
      <Text style={s.muted}>Fast</Text>
      <View style={[styles.swatch, { backgroundColor: colors.lift, marginLeft: 12, height: 3 }]} />
      <Text style={s.muted}>Lift</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.text, borderBottomWidth: 2, borderBottomColor: colors.accent, paddingVertical: 4 },
  replayRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center' },
  timedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 18, height: 6, borderRadius: 3 },
});
