import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams, type ErrorBoundaryProps } from 'expo-router';
import Stack from 'expo-router/stack';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatGrid, StatTile } from '../../components/StatTile';
import { TimelineCard } from '../../components/TimelineCard';
import { exportGpx } from '../../days/files';
import { deleteDayOnline } from '../../friends/sync';
import { lookupPistes, pistesUpToDate } from '../../mountain/pistes';
import { suggestChallenges } from '../../lib/suggest';
import { difficultyBreakdown } from '../../lib/breakdown';
import { DifficultyBar } from '../../components/DifficultyBar';
import { PhotoStrip } from '../../components/PhotoStrip';
import { addPhotos, removePhoto } from '../../days/photos';
import { sportInfo } from '../../lib/sport';
import {
  deleteMotionEvent, deleteSession, getPoints, getSession, kvGet, kvSet, listMotionEvents, listPhotos, listSegments, listSessionAttempts,
  renameSession, type MotionRow, type PhotoRow, type SessionRow,
} from '../../db';
import { eventsBetween, jumpHeight, summariseMotion } from '../../lib/motion';
import type { Attempt, Segment } from '../../lib/segments';
import {
  fmtAir, fmtAlt, fmtDate, fmtDist, fmtDuration, fmtG, fmtJumpHeight, fmtRaceTime, fmtSpeed, fmtTimeOfDay,
} from '../../lib/format';
import { cleanTrack, computeStats, statsForSport } from '../../lib/stats';
import type { Activity, TrackPoint, Units } from '../../lib/types';
import type { MotionSummary } from '../../lib/motion';
import type { PisteMatch } from '../../lib/pistes';
import { useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';

/** One ski day: the day's numbers and every run. Tap a run to see it on the map. */
export default function DayScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { units } = useSettings();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [raw, setRaw] = useState<TrackPoint[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [timed, setTimed] = useState<{ attempt: Attempt; segment: Segment }[]>([]);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [hideSuggest, setHideSuggest] = useState(true);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [motion, setMotion] = useState<MotionRow[]>([]);
  const [lookupFailed, setLookupFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    getSession(id).then((ses) => {
      setSession(ses);
      setName(ses?.place ?? '');
      // Piste names from OpenStreetMap, looked up once per day (needs internet; retried next time if offline).
      if (ses && !pistesUpToDate(ses.pistes) && !ses.isDemo) {
        lookupPistes(ses.id).then((p) => {
          if (p) setSession((cur) => (cur ? { ...cur, pistes: p } : cur));
          else setLookupFailed(true);
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

  // Recompute from raw points so indices always match the cleaned track.
  const sport = session?.sport;
  const day = useMemo(() => {
    if (!raw) return null;
    return { pts: cleanTrack(raw), stats: statsForSport(computeStats(raw), sport) };
  }, [raw, sport]);

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

  const { stats } = day;
  const suggestedRunNo = suggestion ? stats.activities.slice(0, suggestion.activityIndex + 1).filter((a) => a.kind === 'run').length : 0;
  const timeline = stats.activities;
  // Out-of-date names would show the runs found since as "Piste unknown": wait for the new lookup.
  const shares = pistesUpToDate(session.pistes) ? difficultyBreakdown([{ activities: timeline, pistes: session.pistes }]) : [];
  const motionDay = summariseMotion(motion);
  const runOfEvent = (t: number) => {
    const i = timeline.findIndex((a) => a.kind === 'run' && t >= a.startTime - 5000 && t <= a.endTime + 5000);
    return i >= 0 ? i : null;
  };
  // A jump or fall: open the run it happened on.
  const showEvent = (t: number) => {
    const i = runOfEvent(t);
    if (i != null) router.push({ pathname: '/run', params: { session: session.id, i: String(i) } });
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
    <ScrollView style={s.screen} contentContainerStyle={styles.content} testID="day-scroll">
      <Stack.Screen
        options={{
          title: fmtDate(session.startedAt),
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 16 }}>
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
        {sportInfo(session.sport).label} · {fmtTimeOfDay(session.startedAt)} – {fmtTimeOfDay(session.endedAt ?? session.startedAt)} · {fmtDuration(stats.duration)} on the mountain
      </Text>

      <StatGrid>
        <StatTile label="Top speed" value={fmtSpeed(stats.topSpeed, units)} sub={stats.topSpeedTime ? `at ${fmtTimeOfDay(stats.topSpeedTime)}` : undefined} />
        <StatTile label="Vertical ↓" value={fmtAlt(stats.verticalDown, units)} sub={`↑ ${fmtAlt(stats.verticalUp, units)}`} />
        <StatTile label="Peak altitude" value={fmtAlt(stats.maxAlt, units)} sub={`Lowest ${fmtAlt(stats.minAlt, units)}`} />
        <StatTile label="Runs" value={String(stats.runCount)} sub={`Longest ${fmtDist(stats.longestRun, units)}`} />
        <StatTile label="Distance skied" value={fmtDist(stats.skiDistance, units)} sub={`Total ${fmtDist(stats.distance, units)}`} />
        <StatTile label="Avg ski speed" value={fmtSpeed(stats.avgSkiSpeed, units)} />
        <StatTile label="Ski time" value={fmtDuration(stats.skiTime)} sub={`Lifts ${fmtDuration(stats.liftTime)}`} />
        <StatTile label="Lift lines" value={fmtDuration(stats.liftWaitTime ?? 0)} sub={stats.liftCount ? `≈ ${fmtDuration((stats.liftWaitTime ?? 0) / stats.liftCount)} per lift` : undefined} />
        {(stats.tourVertical ?? 0) > 0 ? (
          <StatTile label="Climbed on skins" value={fmtAlt(stats.tourVertical ?? 0, units)} sub={fmtDuration(stats.tourTime ?? 0)} />
        ) : null}
        <StatTile label="Turns" value={String(stats.turns ?? 0)} sub={stats.maxG ? `Strongest ${fmtG(stats.maxG)}` : undefined} />
        <StatTile
          label="Jumps"
          value={String(motionDay.jumps)}
          sub={motionDay.jumps ? `Best ${fmtAir(motionDay.bestAir)} · total ${fmtAir(motionDay.totalAir)}` : undefined}
        />
        <StatTile label="Falls" value={String(motionDay.falls)} sub={stats.runCount ? `${stats.runCount - new Set(motion.filter((e) => e.kind === 'fall').map((e) => runOfEvent(e.t)).filter((i) => i != null)).size} without a fall` : undefined} />
      </StatGrid>

      <DifficultyBar shares={shares} units={units} />
      {!shares.length && !session.isDemo && stats.runCount ? (
        <Text style={s.muted}>{lookupFailed ? 'Couldn’t look up the pistes (no internet, or the map server is busy). Open this day again to retry.' : 'Looking up the pistes…'}</Text>
      ) : null}

      <Text style={[s.h2, { marginTop: 8 }]}>Runs</Text>
      <Text style={s.muted}>Tap a run to see it on the map. Tap 🏳 to make it a challenge for your friends.</Text>
      {stats.runCount === 0 ? <Text style={s.muted}>No runs detected.</Text> : null}
      <RunList
        timeline={timeline}
        numbers={numbers}
        units={units}
        pistes={session.pistes}
        motionByRun={motionByRun}
        sessionId={session.id}
      />

      {motion.length ? (
        <View style={[s.card, { gap: 4 }]}>
          <Text style={s.label}>Jumps and falls</Text>
          {motion.map((e) => {
            const r = runOfEvent(e.t);
            return (
              <Pressable key={`${e.kind}-${e.t}`} onPress={() => showEvent(e.t)} onLongPress={() => removeEvent(e)} style={styles.timedRow}>
                <Text style={{ fontSize: 17 }}>{e.kind === 'jump' ? '🦘' : '💥'}</Text>
                <Text style={[s.body, { flex: 1, fontWeight: '600' }]}>
                  {e.kind === 'jump' ? `${fmtAir(e.value)} airtime` : 'Fall'}
                  <Text style={s.muted}>
                    {e.kind === 'jump' ? `  ${fmtJumpHeight(jumpHeight(e.value), units)} high` : `  ${fmtG(e.value)} impact`}
                  </Text>
                </Text>
                <Text style={s.muted}>{r != null ? `Run ${numbers[r]} · ` : ''}{fmtTimeOfDay(e.t)}</Text>
              </Pressable>
            );
          })}
          <Text style={[s.muted, { fontSize: 12 }]}>Tap to open the run it was on. Press and hold to remove one that wasn’t real.</Text>
        </View>
      ) : null}

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
          <Text style={{ fontSize: 24 }}>🏁</Text>
          <View style={{ flex: 1, gap: 8 }}>
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
              <Text style={[s.body, { fontWeight: '700', minWidth: 64, textAlign: 'right' }]}>{fmtRaceTime(attempt.time)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

    </ScrollView>
  );
}

/** Every run of the day; each opens its own screen with the map. Memoised: it's the longest part of the page. */
const RunList = memo(function RunList({ timeline, numbers, units, pistes, motionByRun, sessionId }: {
  timeline: Activity[];
  numbers: number[];
  units: Units;
  pistes: Record<string, PisteMatch> | null;
  motionByRun: (MotionSummary | undefined)[];
  sessionId: string;
}) {
  return (
    <>
      {timeline.map((a, i) =>
        a.kind === 'run' ? (
          <TimelineCard
            key={i}
            activity={a}
            number={numbers[i]}
            units={units}
            piste={pistes?.[String(a.startTime)] ?? null}
            motion={motionByRun[i]}
            onChallenge={() => router.push({ pathname: '/segment/new', params: { session: sessionId, run: String(i) } })}
            onPress={() => router.push({ pathname: '/run', params: { session: sessionId, i: String(i) } })}
          />
        ) : null,
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

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: { flex: 1, fontSize: 20, fontWeight: '600', color: colors.text, borderBottomWidth: 2, borderBottomColor: colors.accent, paddingVertical: 4 },
    play: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    suggest: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    link: { color: colors.accent, fontWeight: '700', fontSize: 15 },
    timedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  });
