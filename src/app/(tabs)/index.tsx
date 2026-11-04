import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatGrid, StatTile } from '../../components/StatTile';
import { badgesEarnedBy } from '../../days/badges';
import { fmtAir, fmtAlt, fmtClock, fmtDelta, fmtDist, fmtDuration, fmtG, fmtJumpHeight, fmtRaceTime, fmtTimeOfDay, speedUnit, speedValue, fmtSpeed } from '../../lib/format';
import { jumpHeight } from '../../lib/motion';
import { liveStatus } from '../../lib/stats';
import { updateSettings, useSettings } from '../../settings';
import { MountainCard } from '../../components/MountainCard';
import { SportPicker } from '../../components/SportPicker';
import { useTheme, useStyles, type Palette } from '../../theme';
import { dismissFall, dismissFinish, dismissLastRun, notAFall, pauseDay, resumeDay, startDay, stopDay, useTracker, type LiveRace, type RaceFinish, type RunSummary } from '../../tracking/tracker';

const statusLabels = (colors: Palette) => ({
  skiing: { text: 'Skiing', icon: 'trending-down', color: colors.run },
  lift: { text: 'On a lift', icon: 'arrow-up', color: colors.lift },
  stopped: { text: 'Stopped', icon: 'pause', color: colors.muted },
  moving: { text: 'Moving', icon: 'walk', color: colors.good },
}) as const;

export default function RecordScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const t = useTracker();
  const { units, simulate, sport } = useSettings();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const finish = () =>
    Alert.alert('Finish your day?', 'Your day will be saved to Days.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Finish',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            const id = await stopDay();
            if (id) {
              router.push(`/day/${id}`);
              const fresh = await badgesEarnedBy(id).catch(() => []);
              if (fresh.length) {
                Alert.alert(
                  fresh.length === 1 ? '🏅 New badge!' : `🏅 ${fresh.length} new badges!`,
                  fresh.map((b) => `${b.emoji} ${b.title}: ${b.description}`).join('\n'),
                );
              }
            }
            else Alert.alert('Too short to save', 'Record at least a minute of GPS to save a day.');
          }),
      },
    ]);

  const st = t.stats;
  const waiting = t.status === 'recording' && t.points.length === 0;
  const live = t.status === 'recording' && st ? statusLabels(colors)[liveStatus(st, t.currentSpeed)] : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      {t.recovered ? (
        <View style={[s.card, styles.banner]}>
          <Ionicons name="time-outline" size={20} color={colors.warn} />
          <Text style={[s.body, { flex: 1 }]}>
            Your day from {t.active ? fmtTimeOfDay(t.active.startedAt) : ''} wasn’t finished. Resume recording or finish it.
          </Text>
        </View>
      ) : null}

      {t.fallAlert ? <FallCard key={t.fallAlert.t} /> : null}
      {t.finish ? <FinishCard f={t.finish} /> : null}
      {t.race && t.status === 'recording' ? <RaceCard r={t.race} /> : null}
      {t.newTop && t.status === 'recording' ? (
        <View style={[s.card, styles.topFlash]}>
          <Text style={{ fontSize: 26 }}>⚡</Text>
          <Text style={styles.topFlashText}>New top speed: {fmtSpeed(t.newTop.speed, units)}</Text>
        </View>
      ) : null}
      {t.jump && t.status === 'recording' ? (
        <View style={[s.card, styles.topFlash, { borderLeftColor: colors.good, backgroundColor: colors.accentSoft }]}>
          <Text style={{ fontSize: 26 }}>🦘</Text>
          <Text style={styles.topFlashText}>
            Jump! {fmtAir(t.jump.airtime)} airtime · {fmtJumpHeight(jumpHeight(t.jump.airtime), units)} high
          </Text>
        </View>
      ) : null}
      {t.lastRun && t.status !== 'idle' && !t.race ? <RunCard r={t.lastRun} /> : null}

      <View style={[s.card, styles.hero]}>
        <Pressable
          onPress={() => router.push('/sos')}
          style={styles.sos}
          hitSlop={8}
          accessibilityLabel="Emergency: call for help and show my coordinates"
        >
          <Ionicons name="medkit" size={14} color="#fff" />
          <Text style={styles.sosText}>SOS</Text>
        </Pressable>
        <View style={styles.chipRow}>
          {t.status === 'idle' ? (
            <Chip text={simulate ? 'Ready · simulated GPS' : 'Ready'} icon="snow" color={colors.accent} />
          ) : t.status === 'paused' ? (
            <Chip text="Paused" icon="pause" color={colors.warn} />
          ) : t.autoPaused ? (
            <Chip text="Auto-paused · break" icon="cafe" color={colors.warn} />
          ) : waiting ? (
            <Chip text="Waiting for GPS…" icon="locate" color={colors.muted} />
          ) : live ? (
            <Chip text={live.text} icon={live.icon} color={live.color} />
          ) : null}
          {t.active?.source === 'sim' ? <Chip text="Demo" icon="flask-outline" color={colors.muted} /> : null}
        </View>
        <Text style={styles.speed} adjustsFontSizeToFit numberOfLines={1}>
          {t.status === 'recording' ? speedValue(t.currentSpeed, units).toFixed(0) : '0'}
        </Text>
        <Text style={styles.speedUnit}>{speedUnit(units)}</Text>
        <Text style={s.muted}>
          {st ? `${fmtClock(st.duration)} on the mountain` : 'Tap start when you reach the slopes'}
        </Text>
        {t.battery && t.status !== 'idle' ? (
          <View style={styles.batteryRow}>
            <Ionicons
              name={t.battery.level < 0.2 ? 'battery-dead' : t.battery.level < 0.5 ? 'battery-half' : 'battery-full'}
              size={16}
              color={t.battery.level < 0.2 ? colors.danger : colors.muted}
            />
            <Text style={[s.muted, t.battery.level < 0.2 && { color: colors.danger }]}>
              {Math.round(t.battery.level * 100)}%
              {t.battery.hoursLeft != null ? ` · about ${fmtHours(t.battery.hoursLeft)} of tracking left` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      {t.status !== 'recording' || t.points.length ? <MountainCard points={t.points} units={units} /> : null}

      {st || t.status !== 'idle' ? (
        <StatGrid>
          <StatTile label="Top speed" value={fmtSpeed(st?.topSpeed ?? 0, units)} />
          <StatTile label="Vertical ↓" value={fmtAlt(st?.verticalDown ?? 0, units)} />
          <StatTile label="Runs" value={String(st?.runCount ?? 0)} sub={`${st?.liftCount ?? 0} lifts`} />
          <StatTile label="Ski time" value={fmtDuration(st?.skiTime ?? 0)} sub={`Lifts ${fmtDuration(st?.liftTime ?? 0)} · line ${fmtDuration(st?.liftWaitTime ?? 0)}`} />
          <StatTile label="Distance" value={fmtDist(st?.distance ?? 0, units)} sub={`Skied ${fmtDist(st?.skiDistance ?? 0, units)}`} />
          <StatTile label="Altitude" value={fmtAlt(t.points.length ? t.points[t.points.length - 1].alt : null, units)} sub={st?.maxAlt != null ? `Max ${fmtAlt(st.maxAlt, units)}` : undefined} />
          <StatTile label="Turns" value={String(st?.turns ?? 0)} sub={st?.maxG ? `Strongest ${fmtG(st.maxG)}` : undefined} />
          <StatTile
            label="Jumps"
            value={String(t.motion.jumps)}
            sub={`${t.motion.bestAir ? `Best ${fmtAir(t.motion.bestAir)} · ` : ''}${t.motion.falls} ${t.motion.falls === 1 ? 'fall' : 'falls'}`}
          />
        </StatGrid>
      ) : (
        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.h2}>How it works</Text>
          <Text style={s.body}>
            Start recording at the lift and put your phone in your pocket. Every run and lift ride is detected
            automatically: top speed, vertical, distance and time on the snow.
          </Text>
          {simulate ? (
            <Text style={s.muted}>Simulated GPS is on (Profile): a fake ski day plays at 20× speed.</Text>
          ) : null}
        </View>
      )}

      {t.foregroundOnly && t.status === 'recording' ? (
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Background location isn’t allowed, so keep the app open. Allow location “All the time” to track with the screen off.
        </Text>
      ) : null}
      {t.motionLive && t.status === 'recording' && !t.foregroundOnly ? (
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Jumps and falls are picked up while the app is open on screen.
        </Text>
      ) : null}
      {t.error ? <Text style={[s.body, { color: colors.danger, textAlign: 'center' }]}>{t.error}</Text> : null}

      {t.status === 'idle' && !busy ? (
        <SportPicker value={sport} onChange={(sp) => updateSettings({ sport: sp })} />
      ) : null}
      <View style={styles.buttons}>
        {busy ? (
          <ActivityIndicator color={colors.accent} size="large" />
        ) : t.status === 'idle' ? (
          <Button label="Start day" icon="play" color={colors.accent} big onPress={() => run(() => startDay(simulate, sport))} />
        ) : (
          <>
            {t.status === 'recording' ? (
              <Button label="Pause" icon="pause" color={colors.warn} onPress={() => run(pauseDay)} />
            ) : (
              <Button label="Resume" icon="play" color={colors.accent} onPress={() => run(resumeDay)} />
            )}
            <Button label="Finish" icon="stop" color={colors.danger} onPress={finish} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

/** Live challenge: elapsed time, progress, and gap to the ghost you're chasing. */
function RaceCard({ r }: { r: LiveRace }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const ahead = r.delta != null && r.delta < 0;
  const deltaColor = r.delta == null ? colors.muted : ahead ? colors.good : colors.danger;
  return (
    <View style={[s.card, styles.race]}>
      <View style={styles.raceHead}>
        <Ionicons name="flag" size={16} color={colors.onInk} />
        <Text style={styles.raceTitle} numberOfLines={1}>{r.name}</Text>
      </View>
      <View style={styles.raceRow}>
        <Text style={styles.raceTime}>{fmtRaceTime(r.elapsed)}</Text>
        {r.delta != null ? (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.raceDelta, { color: deltaColor }]}>{fmtDelta(r.delta)}</Text>
            <Text style={styles.raceSub}>vs {r.rivalIsMe ? 'your best' : r.rivalName}</Text>
          </View>
        ) : (
          <Text style={styles.raceSub}>First time: set the time to beat!</Text>
        )}
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(r.progress * 100)}%` }]} />
      </View>
    </View>
  );
}

/** What to say when you cross the finish line. */
function finishMessage(f: RaceFinish): string {
  const gap = f.rivalGap != null ? Math.abs(f.rivalGap).toFixed(1) : '';
  if (f.rivalName && f.rivalGap != null) {
    if (f.rivalIsMe) return f.rivalGap < 0 ? `New personal best, ${gap}s faster! 🔥` : `${fmtDelta(f.rivalGap)} off your best. Go again!`;
    if (f.rivalGap < 0) return `You beat ${f.rivalName} by ${gap}s${f.rank === 1 ? ' and took the lead! 🏆' : '!'}`;
    return `${fmtDelta(f.rivalGap)} behind ${f.rivalName}${f.isPersonalBest && f.previousBest != null ? ', but a new personal best!' : '. Go again!'}`;
  }
  if (f.previousBest == null) return 'Your first time! Now challenge a friend to beat it.';
  return f.isPersonalBest ? `New personal best! (was ${fmtRaceTime(f.previousBest)})` : 'Go again!';
}

function FinishCard({ f }: { f: RaceFinish }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const headline = f.of > 1 ? `${fmtRaceTime(f.time)}  ·  #${f.rank} of ${f.of}` : fmtRaceTime(f.time);
  const line = finishMessage(f);
  return (
    <View style={[s.card, styles.finish]}>
      <Text style={{ fontSize: 28 }}>🏁</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{f.name}</Text>
        <Text style={styles.finishTime}>{headline}</Text>
        <Text style={s.body}>{line}</Text>
        {f.splitNote ? <Text style={s.muted}>{f.splitNote}</Text> : null}
        <Pressable onPress={() => router.push(`/segment/${f.segmentId}`)}>
          <Text style={{ color: colors.accent, fontWeight: '700', marginTop: 4 }}>See leaderboard ›</Text>
        </Pressable>
      </View>
      <Pressable onPress={dismissFinish} hitSlop={10} accessibilityLabel="Dismiss">
        <Ionicons name="close" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
}

const FALL_CHECK_SECONDS = 60;

/** After a fall: are you OK? No answer opens the SOS screen. */
function FallCard() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const [left, setLeft] = useState(FALL_CHECK_SECONDS);

  useEffect(() => {
    const timer = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left > 0) return;
    dismissFall();
    router.push('/sos');
  }, [left]);

  return (
    <View style={[s.card, styles.fall]}>
      <View style={styles.runHead}>
        <Text style={styles.fallTitle}>Are you OK?</Text>
        <Text style={styles.fallCount}>{left}s</Text>
      </View>
      <Text style={s.body}>That looked like a hard fall. If you don’t answer, the SOS screen opens with your position.</Text>
      <View style={styles.buttons}>
        <Button label="I’m OK" icon="checkmark" color={colors.good} onPress={dismissFall} />
        <Button label="Get help" icon="medkit" color={colors.danger} onPress={() => { dismissFall(); router.push('/sos'); }} />
      </View>
      <Pressable onPress={() => { notAFall().catch(() => undefined); }} hitSlop={8}>
        <Text style={{ color: colors.accent, fontWeight: '700', textAlign: 'center' }}>That wasn’t a fall</Text>
      </Pressable>
    </View>
  );
}

function fmtHours(h: number): string {
  if (h >= 24) return '24h+';
  return h >= 1 ? `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m` : `${Math.round(h * 60)} min`;
}

/** The run you just finished, shown while you ride the next lift. */
function RunCard({ r }: { r: RunSummary }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units } = useSettings();
  return (
    <View style={[s.card, styles.runCard]}>
      <View style={styles.runHead}>
        <Text style={s.label}>Run {r.number} done</Text>
        <Pressable onPress={dismissLastRun} hitSlop={12} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <View style={styles.runStats}>
        <RunStat label="Top" value={fmtSpeed(r.topSpeed, units)} />
        <RunStat label="Vertical" value={fmtAlt(r.verticalDown, units)} />
        <RunStat label="Distance" value={fmtDist(r.distance, units)} />
        <RunStat label="Time" value={fmtClock(r.duration)} />
      </View>
    </View>
  );
}

function RunStat({ label, value }: { label: string; value: string }) {
  const { s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={[s.label, { fontSize: 10 }]}>{label}</Text>
      <Text style={styles.runValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function Chip({ text, icon, color }: { text: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.chipText, { color }]}>{text}</Text>
    </View>
  );
}

function Button({ label, icon, color, onPress, big }: {
  label: string; icon: React.ComponentProps<typeof Ionicons>['name']; color: string; onPress: () => void; big?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, big && styles.bigButton, { backgroundColor: color, opacity: pressed ? 0.8 : 1 }]}
    >
      <Ionicons name={icon} size={big ? 30 : 26} color={colors.onAccent} />
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    banner: { flexDirection: 'row', gap: 10, alignItems: 'center', borderLeftWidth: 4, borderLeftColor: colors.warn },
    hero: { alignItems: 'center', paddingVertical: 20, gap: 2 },
    chipRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
    sos: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.danger, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    sosText: { color: '#fff', fontWeight: '900', fontSize: 12 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    chipText: { fontSize: 13, fontWeight: '700' },
    speed: { fontSize: 96, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'], lineHeight: 104 },
    speedUnit: { fontSize: 18, fontWeight: '700', color: colors.muted, marginTop: -6, marginBottom: 6 },
    race: { backgroundColor: colors.ink, gap: 8 },
    raceHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    raceTitle: { color: colors.onInk, fontWeight: '800', fontSize: 15, flex: 1 },
    raceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    raceTime: { color: colors.onInk, fontSize: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
    raceDelta: { fontSize: 26, fontWeight: '900', fontVariant: ['tabular-nums'] },
    raceSub: { color: colors.onInkMuted, fontSize: 13, fontWeight: '600' },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
    progressFill: { height: 6, backgroundColor: colors.good },
    finish: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', borderLeftWidth: 4, borderLeftColor: colors.good },
    finishTime: { fontSize: 26, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'] },
    batteryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    topFlash: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.warnSoft, borderLeftWidth: 4, borderLeftColor: colors.warn },
    topFlashText: { fontSize: 18, fontWeight: '800', color: colors.text, flex: 1 },
    fall: { gap: 10, borderWidth: 3, borderColor: colors.danger },
    fallTitle: { fontSize: 26, fontWeight: '900', color: colors.danger },
    fallCount: { fontSize: 22, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
    runCard: { gap: 8, borderLeftWidth: 4, borderLeftColor: colors.run },
    runHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    runStats: { flexDirection: 'row' },
    runValue: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
    buttons: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginTop: 4 },
    // Big targets: easy to hit with ski gloves on.
    button: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', minHeight: 72, borderRadius: 18 },
    bigButton: { minHeight: 88 },
    buttonText: { color: colors.onAccent, fontSize: 22, fontWeight: '800' },
  });
