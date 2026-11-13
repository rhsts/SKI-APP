import { Tap } from '../../components/Tap';
import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { createChallenge } from '../../challenges/service';
import { SegmentMap } from '../../components/SegmentMap';
import { getPoints, getSession } from '../../db';
import { fmtAlt, fmtDist, fmtRaceTime } from '../../lib/format';
import { buildSegmentPath, MIN_SEGMENT_LENGTH, pathInfo } from '../../lib/segments';
import { cleanTrack, computeStats } from '../../lib/stats';
import type { TrackPoint } from '../../lib/types';
import { useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';
import { refreshRacers } from '../../tracking/tracker';

/** Turn (part of) a recorded run into a challenge. */
export default function NewChallengeScreen() {
  const { colors, s } = useTheme();
  const headerHeight = useHeaderHeight();
  const styles = useStyles(makeStyles);
  const { session, run } = useLocalSearchParams<{ session: string; run: string }>();
  const { units } = useSettings();
  const [pts, setPts] = useState<TrackPoint[] | null>(null);
  const [range, setRange] = useState<{ lo: number; hi: number; runNo: number } | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  // Bumped when a slider was dragged past the other one: remounts it so the thumb snaps back to the clamped value.
  const [clamped, setClamped] = useState(0);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [ses, raw] = await Promise.all([getSession(session), getPoints(session)]);
      const clean = cleanTrack(raw);
      const acts = computeStats(raw).activities;
      const a = acts[Number(run)];
      if (!a || a.kind !== 'run') return;
      const runNo = acts.slice(0, Number(run) + 1).filter((x) => x.kind === 'run').length;
      setPts(clean);
      setRange({ lo: a.startIndex, hi: a.endIndex, runNo });
      setStart(a.startIndex);
      setEnd(a.endIndex);
      setName(`Run ${runNo}${ses?.place ? ` · ${ses.place.split(',')[0]}` : ''}`);
    })();
  }, [session, run]);

  const path = useMemo(() => (pts && end > start ? buildSegmentPath(pts, start, end) : []), [pts, start, end]);
  const info = useMemo(() => (path.length > 1 ? pathInfo(path) : { length: 0, drop: null }), [path]);
  const context = useMemo(() => (pts && range ? pts.slice(range.lo, range.hi + 1) : undefined), [pts, range]);

  if (!pts || !range) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  const tooShort = info.length < MIN_SEGMENT_LENGTH;
  const yourTime = (pts[end].t - pts[start].t) / 1000;

  const save = async () => {
    if (tooShort) return;
    setSaving(true);
    try {
      const seg = await createChallenge(session, start, end, name);
      await refreshRacers();
      router.replace(`/segment/${seg.id}`);
    } catch (e) {
      Alert.alert('Couldn’t save the challenge', String(e));
      setSaving(false);
    }
  };

  return (
    // Edge-to-edge Android doesn't resize the window for the keyboard, so pad for it on both platforms.
    <KeyboardAvoidingView style={s.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <ScrollView style={s.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={s.muted}>
          Pick the stretch to race. Timing starts when you leave the green start circle and stops when you reach the
          finish circle. Anyone who skis it, including you next time, gets a time.
        </Text>

        <SegmentMap path={path} context={context} />

        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.label}>Start</Text>
          <Slider
            minimumValue={range.lo}
            maximumValue={range.hi}
            step={1}
            value={start}
            onValueChange={(v) => setStart(Math.min(Math.round(v), end - 1))}
            onSlidingComplete={(v) => { if (Math.round(v) > end - 1) setClamped((n) => n + 1); }}
            key={`start-${clamped}`}
            minimumTrackTintColor={colors.faint}
            maximumTrackTintColor={colors.good}
            thumbTintColor={colors.good}
          />
          <Text style={s.label}>Finish</Text>
          <Slider
            minimumValue={range.lo}
            maximumValue={range.hi}
            step={1}
            value={end}
            onValueChange={(v) => setEnd(Math.max(Math.round(v), start + 1))}
            onSlidingComplete={(v) => { if (Math.round(v) < start + 1) setClamped((n) => n + 1); }}
            key={`end-${clamped}`}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.faint}
            thumbTintColor={colors.text}
          />
          <View style={styles.facts}>
            <Fact label="Length" value={fmtDist(info.length, units)} />
            <Fact label="Drop" value={fmtAlt(info.drop, units)} />
            <Fact label="Your run" value={`≈ ${fmtRaceTime(yourTime)}`} />
          </View>
          {tooShort ? (
            <Text style={[s.muted, { color: colors.danger }]}>Make it at least {fmtDist(MIN_SEGMENT_LENGTH, units)} long.</Text>
          ) : null}
        </View>

        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.label}>Name</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} maxLength={30} placeholder="e.g. Black Diamond Dash" />
        </View>

        <Tap
          onPress={save}
          disabled={saving || tooShort}
          style={[styles.save, (tooShort || saving) && { opacity: 0.5 }]}
        >
          {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.saveText}>Create challenge</Text>}
        </Tap>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={s.label}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    facts: { flexDirection: 'row', marginTop: 8 },
    factValue: { fontSize: 17, fontWeight: '700', color: colors.text },
    input: { fontSize: 17, fontWeight: '500', color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.faint, paddingVertical: 8 },
    save: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    saveText: { color: colors.onAccent, fontSize: 17, fontWeight: '700' },
  });
