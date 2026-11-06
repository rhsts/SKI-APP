import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams, type ErrorBoundaryProps } from 'expo-router';
import Stack from 'expo-router/stack';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ElevationChart } from '../../components/ElevationChart';
import { SpeedChart } from '../../components/SpeedChart';
import { RouteMap } from '../../components/RouteMap';
import { StatGrid, StatTile } from '../../components/StatTile';
import { BreakRow, TimelineCard } from '../../components/TimelineCard';
import { exportGpx } from '../../days/files';
import { deleteDayOnline } from '../../friends/sync';
import { lookupPistes, pistesUpToDate } from '../../mountain/pistes';
import { mapFor, type TrailMap } from '../../lib/trailmap';
import { suggestChallenges } from '../../lib/suggest';
import { difficultyBreakdown } from '../../lib/breakdown';
import { DifficultyBar } from '../../components/DifficultyBar';
import { PhotoStrip } from '../../components/PhotoStrip';
import { addPhotos, removePhoto } from '../../days/photos';
import { SportPicker } from '../../components/SportPicker';
import {
  deleteMotionEvent, deleteSession, getPoints, getSession, kvGet, kvSet, listMotionEvents, listPhotos, listSegments, listSessionAttempts, listTrailMaps,
  renameSession, setSessionSport, type MotionRow, type PhotoRow, type SessionRow,
} from '../../db';
import { eventsBetween, jumpHeight, summariseMotion } from '../../lib/motion';
import type { Attempt, Segment } from '../../lib/segments';
import {
  fmtAir, fmtAlt, fmtDate, fmtDist, fmtDuration, fmtG, fmtJumpHeight, fmtRaceTime, fmtSpeed, fmtTimeOfDay,
} from '../../lib/format';
import { activityAt } from '../../lib/scrub';
import { cleanTrack, computeStats, smoothedAltitudes, smoothedSpeeds, statsForSport } from '../../lib/stats';
import type { Activity, TrackPoint, Units } from '../../lib/types';
import type { MotionSummary } from '../../lib/motion';
import type { PisteMatch } from '../../lib/pistes';
import { useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';

const REPLAY_RATE = 8; // a run plays back 8× faster than real time

export default function DayScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
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
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [hideSuggest, setHideSuggest] = useState(true);
  const [trail, setTrail] = useState<TrailMap | null>(null);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [motion, setMotion] = useState<MotionRow[]>([]);
  // Replay readout keeps the tallest height it has had (2 lines minimum) so the graph below never moves.
  const { fontScale } = useWindowDimensions();
  const [readoutH, setReadoutH] = useState(0);

  useEffect(() => {
    if (!id) return;
    getSession(id).then((ses) => {
      setSession(ses);
      setName(ses?.place ?? '');
      // Piste names from OpenStreetMap, looked up once per day (needs internet; retried next time if offline).
      if (ses && !pistesUpToDate(ses.pistes) && !ses.isDemo) {
        lookupPistes(ses.id).then((p) => {
          if (p) setSession((cur) => (cur ? { ...cur, pistes: p } : cur));
        });
      }
    });
    getPoints(id).then(setRaw);
    listPhotos(id).then(setPhotos).catch(() => setPhotos([]));
    listMotionEvents(id).then(setMotion).catch(() => setMotion([]));
  }, [id]);

  // Challenge times set on this day (refreshed when coming back from creating one).
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      kvGet(`suggest-dismissed:${id}`).then((v) => setHideSuggest(v === '1'));
      Promise.all([listSessionAttempts(id), listSegments()]).then(([atts, segs]) => {
        setSegments(segs);
        const byId = new Map(segs.map((x) => [x.id, x]));
        setTimed(atts.filter((a) => byId.has(a.segmentId)).map((a) => ({ attempt: a, segment: byId.get(a.segmentId)! })));
      });
    }, [id]),
  );

  // Offline trail map for this area (saved when the day's pistes were looked up, or downloaded).
  useEffect(() => {
    if (!raw?.length || !session?.pistes) return;
    const mid = raw[Math.floor(raw.length / 2)];
    listTrailMaps().then((maps) => setTrail(mapFor(maps, mid)));
  }, [raw, session?.pistes]);

  // Recompute from raw points so indices always match the cleaned track.
  const sport = session?.sport;
  const day = useMemo(() => {
    if (!raw) return null;
    const pts = cleanTrack(raw);
    return {
      pts, times: pts.map((p) => p.t), speeds: smoothedSpeeds(pts), alts: smoothedAltitudes(pts),
      stats: statsForSport(computeStats(raw), sport),
    };
  }, [raw, sport]);

  // The run shown in the graph: the one you tapped, otherwise the first run of the day.
  const runIdxs = useMemo(
    () => (day ? day.stats.activities.map((a, i) => (a.kind === 'run' ? i : -1)).filter((i) => i >= 0) : []),
    [day],
  );
  const selected = focus != null && runIdxs.includes(focus) ? focus : runIdxs[0] ?? null;
  const selRun = day && selected != null ? day.stats.activities[selected] : null;
  const range = selRun ? { a: selRun.startIndex, b: selRun.endIndex } : null;

  // Replay: advance the cursor through the selected run.
  const cursorRef = useRef(cursor);
  const rangeRef = useRef(range);
  useEffect(() => {
    cursorRef.current = cursor;
    rangeRef.current = range;
  });
  useEffect(() => {
    if (!playing || !day) return;
    const timer = setInterval(() => {
      const pts = day.pts;
      const r = rangeRef.current;
      if (!r) { setPlaying(false); return; }
      let i = Math.max(r.a, Math.min(cursorRef.current ?? r.a, r.b));
      if (i >= r.b) { setPlaying(false); return; }
      const target = pts[i].t + (REPLAY_RATE * 1000) / 20;
      while (i < r.b && pts[i].t < target) i++;
      cursorRef.current = i;
      setCursor(i);
    }, 50);
    return () => clearInterval(timer);
  }, [playing, day]);

  // Graph data for just the selected run (indices start at 0 within the run).
  const runGraph = useMemo(() => {
    if (!day || !selRun) return null;
    const a = selRun.startIndex, b = selRun.endIndex + 1;
    return {
      times: day.times.slice(a, b),
      alts: day.alts.slice(a, b),
      speeds: day.speeds.slice(a, b),
      activities: [{ ...selRun, startIndex: 0, endIndex: b - a - 1 }],
    };
  }, [day, selRun]);

  const selectRun = useCallback((i: number | null) => {
    setPlaying(false);
    setFocus(i);
    const a = i != null ? day?.stats.activities[i] : null;
    setCursor(a ? a.startIndex : null);
  }, [day]);

  // While a finger is on the graph the page must not scroll: on Android the scroll view
  // would otherwise take the gesture over and the replay stops mid-drag.
  const [scrubbing, setScrubbing] = useState(false);
  const onScrubStart = useCallback(() => {
    setPlaying(false);
    setScrubbing(true);
  }, []);
  const onScrubEnd = useCallback(() => setScrubbing(false), []);
  // Touch moves can come in faster than the screen redraws: apply at most one per frame.
  const pendingScrub = useRef<number | null>(null);
  const onScrub = useCallback((i: number) => {
    const r = rangeRef.current;
    if (!r) return;
    const first = pendingScrub.current == null;
    pendingScrub.current = r.a + i;
    if (first) {
      requestAnimationFrame(() => {
        const next = pendingScrub.current;
        pendingScrub.current = null;
        if (next != null) setCursor(next);
      });
    }
  }, []);

  // Tapping a card in the timeline: a run becomes the graphed run; a lift is just highlighted.
  const focusRef = useRef(focus);
  useEffect(() => {
    focusRef.current = focus;
  });
  const onTimelinePress = useCallback((i: number) => {
    const a = day?.stats.activities[i];
    if (!a) return;
    const next = focusRef.current === i ? null : i;
    if (a.kind === 'run' && next != null) {
      selectRun(next);
      return;
    }
    setFocus(next);
    setPlaying(false);
    setCursor(next == null ? null : a.startIndex);
  }, [day, selectRun]);

  // Heavy bits that don't depend on the replay position: computed once, not on every drag.
  const suggestion = useMemo(
    () => (day && segments && !hideSuggest ? suggestChallenges(day.pts, day.stats.activities, segments)[0] ?? null : null),
    [day, segments, hideSuggest],
  );
  const numbers = useMemo(() => {
    let runNo = 0, liftNo = 0, tourNo = 0;
    return (day?.stats.activities ?? []).map((a) => (a.kind === 'run' ? ++runNo : a.kind === 'lift' ? ++liftNo : a.kind === 'tour' ? ++tourNo : 0));
  }, [day]);
  const motionByRun = useMemo(
    () => (day?.stats.activities ?? []).map((a) => (a.kind === 'run' ? summariseMotion(eventsBetween(motion, a.startTime, a.endTime)) : undefined)),
    [day, motion],
  );

  if (!session || !day) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  const { pts, speeds, stats } = day;
  const suggestedRunNo = suggestion ? stats.activities.slice(0, suggestion.activityIndex + 1).filter((a) => a.kind === 'run').length : 0;
  const timeline = stats.activities;
  const shares = session.pistes && Object.keys(session.pistes).length ? difficultyBreakdown([{ activities: timeline, pistes: session.pistes }]) : [];
  const cur = cursor != null ? pts[cursor] : null;
  // A run's last point is shared with the next activity; inside the graphed run it still belongs to that run.
  const curActivity = cursor == null ? null : selRun && range && (focus == null || focus === selected) && cursor >= range.a && cursor <= range.b ? selRun : activityAt(timeline, cursor);
  // Speed is only shown on runs; a lift's speed isn't interesting.
  const readout = cur
    ? [
        fmtTimeOfDay(cur.t),
        curActivity?.kind === 'run' ? fmtSpeed(speeds[cursor!], units) : null,
        fmtAlt(day.alts[cursor!], units), // smoothed, like the graph
        curActivity?.kind === 'run' ? 'Run' : curActivity?.kind === 'lift' ? 'On lift' : null,
      ].filter(Boolean).join(' · ')
    : 'Press play, or drag on the graph';
  const localCursor = range && cursor != null && cursor >= range.a && cursor <= range.b ? cursor - range.a : null;
  const selNo = selected != null ? numbers[selected] : 0;
  const motionDay = summariseMotion(motion);
  const selMotion = selected != null ? motionByRun[selected] ?? null : null;
  const runOfEvent = (t: number) => {
    const i = timeline.findIndex((a) => a.kind === 'run' && t >= a.startTime - 5000 && t <= a.endTime + 5000);
    return i >= 0 ? i : null;
  };
  const showEvent = (t: number) => {
    const i = runOfEvent(t);
    if (i != null) selectRun(i);
    let k = 0;
    while (k < pts.length - 1 && pts[k].t < t) k++;
    setCursor(k);
  };
  const removeEvent = (e: MotionRow) =>
    Alert.alert(e.kind === 'jump' ? 'Remove this jump?' : 'Remove this fall?', 'It will no longer count in your stats.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteMotionEvent(session.id, e.t, e.kind);
          setMotion((cur) => cur.filter((x) => !(x.t === e.t && x.kind === e.kind)));
        },
      },
    ]);

  const remove = () =>
    Alert.alert('Delete this day?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          await deleteSession(session.id);
          // Off your groups' leaderboards and out of your online backup too (retried later if there's no signal).
          deleteDayOnline(session.id).catch(() => undefined);
          router.back();
        } },
    ]);

  const gpx = () =>
    exportGpx(session.id).catch((e) => Alert.alert('Couldn’t export', e instanceof Error ? e.message : String(e)));

  // Android shows at most three buttons in an alert.
  const menu = () =>
    Alert.alert(session.place ?? 'Ski day', undefined, [
      { text: 'Export GPX (Strava, Komoot…)', onPress: gpx },
      { text: 'Delete day', style: 'destructive', onPress: remove },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const saveName = async () => {
    await renameSession(session.id, name);
    setSession({ ...session, place: name.trim() || null });
    setEditing(false);
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content} scrollEnabled={!scrubbing} testID="day-scroll">
      <Stack.Screen
        options={{
          title: fmtDate(session.startedAt),
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <Pressable onPress={() => router.push({ pathname: '/day/share', params: { id: session.id } })} hitSlop={10} accessibilityLabel="Share as image">
                <Ionicons name="share-social-outline" size={22} color={colors.accent} />
              </Pressable>
              <Pressable onPress={menu} hitSlop={10} accessibilityLabel="More">
                <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={colors.accent} />
              </Pressable>
            </View>
          ),
        }}
      />

      {editing ? (
        <View style={styles.titleRow}>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholderTextColor={colors.muted} autoFocus placeholder="Resort or place" onSubmitEditing={saveName} />
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
      <SportPicker
        value={session.sport}
        onChange={(sp) => {
          setSession({ ...session, sport: sp });
          setSessionSport(session.id, sp);
        }}
      />

      <RouteMap
        points={pts}
        speeds={speeds}
        activities={timeline}
        cursor={cursor}
        focus={focus}
        trail={trail}
        photos={photos}
        onPhotoPress={setOpenPhoto}
      />

      <View style={[s.card, { gap: 8 }]}>
        {runIdxs.length ? (
          <>
            {/* Which run is graphed: step through them here, or tap one in the timeline below. */}
            <View style={styles.runNav}>
              <Pressable
                onPress={() => selected != null && selectRun(runIdxs[runIdxs.indexOf(selected) - 1])}
                disabled={selected == null || runIdxs.indexOf(selected) <= 0}
                hitSlop={12}
                style={[styles.navBtn, (selected == null || runIdxs.indexOf(selected) <= 0) && { opacity: 0.3 }]}
                accessibilityLabel="Previous run"
              >
                <Ionicons name="chevron-back" size={22} color={colors.accent} />
              </Pressable>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={s.h2}>Run {selNo} of {runIdxs.length}</Text>
                {selRun ? <Text style={s.muted}>{fmtTimeOfDay(selRun.startTime)} · tap a run below to graph it</Text> : null}
              </View>
              <Pressable
                onPress={() => selected != null && selectRun(runIdxs[runIdxs.indexOf(selected) + 1])}
                disabled={selected == null || runIdxs.indexOf(selected) >= runIdxs.length - 1}
                hitSlop={12}
                style={[styles.navBtn, (selected == null || runIdxs.indexOf(selected) >= runIdxs.length - 1) && { opacity: 0.3 }]}
                accessibilityLabel="Next run"
              >
                <Ionicons name="chevron-forward" size={22} color={colors.accent} />
              </Pressable>
            </View>
            <View style={styles.replayRow}>
              <Pressable
                onPress={() => {
                  if (!range) return;
                  if (!playing && (cursor == null || cursor < range.a || cursor >= range.b)) setCursor(range.a);
                  setPlaying(!playing);
                }}
                style={styles.play}
                accessibilityLabel={playing ? 'Pause replay' : `Replay run ${selNo}`}
              >
                <Ionicons name={playing ? 'pause' : 'play'} size={22} color={colors.onAccent} />
              </Pressable>
              <View style={{ flex: 1 }}>
                {selRun ? <Text style={s.label}>{fmtSpeed(selRun.topSpeed, units)} top · {fmtAlt(selRun.verticalDown, units)} ↓</Text> : null}
                <Text
                  style={[s.body, { lineHeight: 20, minHeight: Math.max(40 * fontScale, readoutH) }]}
                  onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > readoutH) setReadoutH(h); }}
                >
                  {readout}
                </Text>
                {selRun ? (
                  <Text style={s.muted}>
                    {[
                      selRun.turns != null ? `🌀 ${selRun.turns} turns${selRun.maxG ? ` · max ${fmtG(selRun.maxG)}` : ''}` : null,
                      selMotion?.jumps ? `🦘 ${selMotion.jumps} ${selMotion.jumps === 1 ? 'jump' : 'jumps'}` : null,
                      selMotion?.falls ? `💥 ${selMotion.falls} ${selMotion.falls === 1 ? 'fall' : 'falls'}` : null,
                    ].filter(Boolean).join('   ')}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => selected != null && router.push({ pathname: '/run', params: { session: session.id, i: String(selected) } })}
                hitSlop={10}
                accessibilityLabel={`Open run ${selNo} details`}
              >
                <Ionicons name="expand-outline" size={22} color={colors.accent} />
              </Pressable>
            </View>
            {runGraph ? (
              <>
                <ElevationChart
                  times={runGraph.times}
                  alts={runGraph.alts}
                  speeds={runGraph.speeds}
                  activities={runGraph.activities}
                  cursor={localCursor}
                  units={units}
                  onScrubStart={onScrubStart}
                  onScrub={onScrub}
                  onScrubEnd={onScrubEnd}
                />
                <SpeedChart times={runGraph.times} speeds={runGraph.speeds} cursor={localCursor} units={units} height={90} />
              </>
            ) : null}
          </>
        ) : (
          <Text style={s.muted}>No runs on this day to graph yet.</Text>
        )}
        <SpeedLegend />
      </View>

      <StatGrid>
        <StatTile label="Top speed" value={fmtSpeed(stats.topSpeed, units)} sub={stats.topSpeedTime ? `at ${fmtTimeOfDay(stats.topSpeedTime)}` : undefined} />
        <StatTile label="Vertical ↓" value={fmtAlt(stats.verticalDown, units)} sub={`↑ ${fmtAlt(stats.verticalUp, units)}`} />
        <StatTile label="Runs" value={String(stats.runCount)} sub={`Longest ${fmtDist(stats.longestRun, units)}`} />
        <StatTile label="Ski time" value={fmtDuration(stats.skiTime)} sub={`Lifts ${fmtDuration(stats.liftTime)}`} />
        <StatTile label="Lift lines" value={fmtDuration(stats.liftWaitTime ?? 0)} sub={stats.liftCount ? `≈ ${fmtDuration((stats.liftWaitTime ?? 0) / stats.liftCount)} per lift` : undefined} />
        {(stats.tourVertical ?? 0) > 0 ? (
          <StatTile label="Climbed on skins" value={fmtAlt(stats.tourVertical ?? 0, units)} sub={fmtDuration(stats.tourTime ?? 0)} />
        ) : null}
        <StatTile label="Distance skied" value={fmtDist(stats.skiDistance, units)} sub={`Total ${fmtDist(stats.distance, units)}`} />
        <StatTile label="Avg ski speed" value={fmtSpeed(stats.avgSkiSpeed, units)} />
        <StatTile label="Turns" value={String(stats.turns ?? 0)} sub={stats.maxG ? `Strongest ${fmtG(stats.maxG)}` : undefined} />
        <StatTile
          label="Jumps"
          value={String(motionDay.jumps)}
          sub={motionDay.jumps ? `Best ${fmtAir(motionDay.bestAir)} · total ${fmtAir(motionDay.totalAir)}` : undefined}
        />
        <StatTile label="Falls" value={String(motionDay.falls)} sub={stats.runCount ? `${stats.runCount - new Set(motion.filter((e) => e.kind === 'fall').map((e) => runOfEvent(e.t)).filter((i) => i != null)).size} without a fall` : undefined} />
        <StatTile label="Peak altitude" value={fmtAlt(stats.maxAlt, units)} />
        <StatTile label="Lowest point" value={fmtAlt(stats.minAlt, units)} />
      </StatGrid>

      {motion.length ? (
        <View style={[s.card, { gap: 4 }]}>
          <Text style={s.label}>Jumps and falls</Text>
          {motion.map((e) => {
            const r = runOfEvent(e.t);
            return (
              <Pressable key={`${e.kind}-${e.t}`} onPress={() => showEvent(e.t)} onLongPress={() => removeEvent(e)} style={styles.timedRow}>
                <Text style={{ fontSize: 18 }}>{e.kind === 'jump' ? '🦘' : '💥'}</Text>
                <Text style={[s.body, { flex: 1, fontWeight: '700' }]}>
                  {e.kind === 'jump' ? `${fmtAir(e.value)} airtime` : 'Fall'}
                  <Text style={s.muted}>
                    {e.kind === 'jump' ? `  ${fmtJumpHeight(jumpHeight(e.value), units)} high` : `  ${fmtG(e.value)} impact`}
                  </Text>
                </Text>
                <Text style={s.muted}>{r != null ? `Run ${numbers[r]} · ` : ''}{fmtTimeOfDay(e.t)}</Text>
              </Pressable>
            );
          })}
          <Text style={[s.muted, { fontSize: 12 }]}>Tap to see where it was. Press and hold to remove one that wasn’t real.</Text>
        </View>
      ) : null}

      <DifficultyBar shares={shares} units={units} />

      <PhotoStrip
        photos={photos}
        open={openPhoto}
        onOpen={setOpenPhoto}
        busy={addingPhotos}
        onAdd={async () => {
          setAddingPhotos(true);
          try {
            const r = await addPhotos(session.id);
            if (r) {
              setPhotos(await listPhotos(session.id));
              if (r.skipped) Alert.alert('Some photos were skipped', `${r.skipped} ${r.skipped === 1 ? 'photo wasn’t' : 'photos weren’t'} taken during this day.`);
            }
          } catch (e) {
            Alert.alert('Couldn’t add photos', e instanceof Error ? e.message : String(e));
          } finally {
            setAddingPhotos(false);
          }
        }}
        onRemove={async (p) => {
          await removePhoto(p);
          setPhotos((cur) => cur.filter((x) => x.id !== p.id));
        }}
      />

      {suggestion ? (
        <View style={[s.card, styles.suggest]}>
          <Text style={{ fontSize: 26 }}>🏁</Text>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={s.h2}>You skied this line {suggestion.times} times</Text>
            <Text style={s.muted}>
              Make it a challenge to get timed on it from now on and race your friends. Your fastest was Run {suggestedRunNo}.
            </Text>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 2 }}>
              <Pressable onPress={() => router.push({ pathname: '/segment/new', params: { session: session.id, run: String(suggestion.activityIndex) } })}>
                <Text style={styles.link}>Make challenge</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setHideSuggest(true);
                  kvSet(`suggest-dismissed:${session.id}`, '1');
                }}
              >
                <Text style={[styles.link, { color: colors.muted }]}>Not now</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

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
      <DayTimeline
        timeline={timeline}
        numbers={numbers}
        units={units}
        focus={focus}
        pistes={session.pistes}
        motionByRun={motionByRun}
        sessionId={session.id}
        onPress={onTimelinePress}
      />
    </ScrollView>
  );
}

/**
 * The day's runs and lifts. Memoised: it doesn't change while you drag along
 * the graph, so it isn't redrawn on every move.
 */
const DayTimeline = memo(function DayTimeline({ timeline, numbers, units, focus, pistes, motionByRun, sessionId, onPress }: {
  timeline: Activity[];
  numbers: number[];
  units: Units;
  focus: number | null;
  pistes: Record<string, PisteMatch> | null;
  motionByRun: (MotionSummary | undefined)[];
  sessionId: string;
  onPress: (i: number) => void;
}) {
  return (
    <>
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
            piste={pistes?.[String(a.startTime)] ?? null}
            motion={motionByRun[i]}
            onDetails={() => router.push({ pathname: '/run', params: { session: sessionId, i: String(i) } })}
            onChallenge={() => router.push({ pathname: '/segment/new', params: { session: sessionId, run: String(i) } })}
            onPress={() => onPress(i)}
          />
        ),
      )}
    </>
  );
});

/** Shown instead of closing the app if something on this screen throws. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[s.screen, { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }]}>
      <Ionicons name="alert-circle-outline" size={44} color={colors.danger} />
      <Text style={[s.h2, { textAlign: 'center' }]}>Something went wrong showing this day</Text>
      <Text style={[s.muted, { textAlign: 'center' }]}>{error.message}</Text>
      <Pressable onPress={retry} style={styles.play}>
        <Ionicons name="refresh" size={22} color={colors.onAccent} />
      </Pressable>
    </View>
  );
}

function SpeedLegend() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
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

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.text, borderBottomWidth: 2, borderBottomColor: colors.accent, paddingVertical: 4 },
    runNav: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    navBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
    replayRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'center' },
    suggest: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderLeftWidth: 4, borderLeftColor: colors.good },
    link: { color: colors.accent, fontWeight: '800', fontSize: 15 },
    timedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    swatch: { width: 18, height: 6, borderRadius: 3 },
  });
