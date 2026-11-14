import { Ionicons } from '@expo/vector-icons';
import { useBatteryLevel } from 'expo-battery';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appear } from '../../components/Appear';
import { MountainDetails, MountainIntro, mountainSummary, useMountain } from '../../components/Mountain';
import { PlaceSearch } from '../../components/PlaceSearch';
import { RollingNumber } from '../../components/RollingNumber';
import { Row, Rows } from '../../components/Row';
import { Sheet } from '../../components/Sheet';
import { SportPicker } from '../../components/SportPicker';
import { Figure } from '../../components/StatTile';
import { useTabBarSpace } from '../../components/TabBar';
import { Tap } from '../../components/Tap';
import { badgesEarnedBy } from '../../days/badges';
import { kvGet } from '../../db';
import { haptic } from '../../haptics';
import {
  fmtAir, fmtAlt, fmtClock, fmtDate, fmtDelta, fmtDist, fmtDuration, fmtG, fmtJumpHeight, fmtRaceTime, fmtSpeed, fmtTimeOfDay, speedUnit, speedValue,
} from '../../lib/format';
import type { Place } from '../../lib/geocode';
import type { Badge } from '../../lib/goals';
import { jumpHeight } from '../../lib/motion';
import { difficultyColor, difficultyLabel } from '../../lib/pistes';
import { hoursAtRate, TYPICAL_DRAIN_PER_HOUR } from '../../lib/power';
import { sportInfo } from '../../lib/sport';
import { liveStatus } from '../../lib/stats';
import type { Units } from '../../lib/types';
import { updateSettings, useSettings } from '../../settings';
import { chromeShadow, font, motion, radius, size, space, target, useStyles, useTheme, type Palette } from '../../theme';
import {
  dismissFall, dismissFinish, dismissLastRun, DRAIN_KEY, notAFall, pauseDay, resumeDay, startDay, stopDay, useTracker,
  type LiveRace, type RaceFinish, type RunSummary, type TrackerState,
} from '../../tracking/tracker';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Mode = 'speed' | 'vertical' | 'time';
type SheetId = 'place' | 'mountain' | 'sport' | 'figures';
const MODES: { id: Mode; label: string }[] = [
  { id: 'speed', label: 'Speed' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'time', label: 'Time' },
];
const easeOut = Easing.bezier(...motion.easeOut);
/** Below this window height the page drops its second row of figures and one ring, so it still fits. */
const COMPACT_HEIGHT = 760;

/** The one small text label that says what the tracker is doing. */
function stateOf(t: TrackerState): { text: string; dot: 'live' | 'hollow' | 'quiet' } {
  const demo = t.active?.source === 'sim' ? ' · Demo' : '';
  if (t.status === 'paused') return { text: `Paused${demo}`, dot: 'quiet' };
  if (t.autoPaused) return { text: `Auto-paused · break${demo}`, dot: 'quiet' };
  if (!t.points.length || !t.stats) return { text: `Waiting for GPS${demo}`, dot: 'quiet' };
  switch (liveStatus(t.stats, t.currentSpeed)) {
    case 'skiing': return { text: `Skiing${t.stats.runCount ? ` · run ${t.stats.runCount}` : ''}${demo}`, dot: 'live' };
    case 'lift': return { text: `On a lift${demo}`, dot: 'hollow' };
    case 'moving': return { text: `Moving${demo}`, dot: 'quiet' };
    default: return { text: `Stopped${demo}`, dot: 'quiet' };
  }
}

/** The big figure for the chosen metric. */
function heroOf(mode: Mode, t: TrackerState, units: Units): { value: string; unit: string } {
  const st = t.stats;
  if (mode === 'vertical') return { value: fmtAlt(st?.verticalDown ?? 0, units, false), unit: units === 'metric' ? 'm' : 'ft' };
  if (mode === 'time') {
    const d = st?.duration ?? 0;
    return d < 3600
      ? { value: fmtClock(d), unit: 'min' }
      : { value: `${Math.floor(d / 3600)}:${String(Math.floor((d % 3600) / 60)).padStart(2, '0')}`, unit: 'h' };
  }
  const waiting = t.status === 'recording' && !t.points.length;
  return { value: waiting ? '–' : t.status === 'recording' ? speedValue(t.currentSpeed, units).toFixed(0) : '0', unit: speedUnit(units) };
}

/** An estimate, so no false precision: whole hours when there are plenty, minutes only near the end. */
function fmtHours(h: number): string {
  if (h >= 24) return 'more than 24 h';
  if (h >= 3) return `${Math.round(h)} h`;
  return h >= 1 ? `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}` : `${Math.max(1, Math.round(h * 60))} min`;
}

/** "31.2 km" → ["31.2", "km"], so the unit can sit small beside the number. */
function split(text: string): [string, string] {
  const i = text.lastIndexOf(' ');
  return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + 1)];
}

export default function RecordScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const compact = useWindowDimensions().height < COMPACT_HEIGHT;
  const t = useTracker();
  const { units, simulate, sport } = useSettings();
  const idle = t.status === 'idle';
  // A place you searched for is shown until you start: once you record, the mountain is where you are.
  const [place, setPlace] = useState<Place | null>(null);
  const m = useMountain(t.points, idle ? place : null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('speed');
  // One sheet for every detail, so the page itself never grows. `sheet` stays set while it closes.
  const [sheet, setSheet] = useState<SheetId>('mountain');
  const [sheetOpen, setSheetOpen] = useState(false);
  // Badges earned by the day you just finished. They show here first; the day opens when the sheet closes
  // (a sheet opened from this tab can't appear while another screen covers it).
  const [earned, setEarned] = useState<{ dayId: string; badges: Badge[] } | null>(null);
  const [footerHeight, setFooterHeight] = useState(tabSpace + target.control + space.md);
  const [today] = useState(() => fmtDate(Date.now()).replace(/ \d{4}$/, ''));
  // Before recording there is no drain to measure: use the rate this phone showed last time, or a typical one.
  const batteryLevel = useBatteryLevel();
  const [drain, setDrain] = useState(TYPICAL_DRAIN_PER_HOUR);
  useEffect(() => {
    kvGet(DRAIN_KEY).then((v) => { if (Number(v) > 0) setDrain(Number(v)); }).catch(() => undefined);
  }, [idle]);

  const show = (id: SheetId) => {
    setSheet(id);
    setSheetOpen(true);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const finish = () =>
    run(async () => {
      haptic('record');
      const id = await stopDay();
      if (!id) {
        Alert.alert('Too short to save', 'Record at least a minute of GPS to save a day.');
        return;
      }
      const fresh = await badgesEarnedBy(id).catch(() => []);
      if (fresh.length) setEarned({ dayId: id, badges: fresh });
      else router.push(`/day/${id}`);
    });

  const seeDay = () => {
    if (!earned) return;
    setEarned(null);
    router.push(`/day/${earned.dayId}`);
  };

  // A tap asks first; holding the button for a second is the confirmation.
  const confirmFinish = () =>
    Alert.alert('Finish your day?', 'Your day will be saved to Days.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Finish', style: 'destructive', onPress: finish },
    ]);

  const st = t.stats;
  const state = idle ? null : stateOf(t);
  const flash = t.newTop && t.status === 'recording' ? t.newTop : null;
  const hero = flash ? { value: fmtSpeed(flash.speed, units, false), unit: speedUnit(units) } : heroOf(mode, t, units);
  const hoursLeft = idle ? (batteryLevel >= 0 ? hoursAtRate(batteryLevel, drain) : null) : t.battery?.hoursLeft ?? null;
  const lowBattery = hoursLeft != null && hoursLeft < 1.5;
  const [distance, distanceUnit] = split(fmtDist(st?.distance ?? 0, units));
  const sheetTitle = { place: 'Find a place', mountain: m.name ?? 'Snow and trail map', sport: 'Sport', figures: 'All figures' }[sheet];

  const tracking = hoursLeft != null ? (
    <View style={[styles.battery, idle && styles.centerSelf]} accessible>
      <Ionicons name={lowBattery ? 'battery-dead-outline' : 'battery-half-outline'} size={20} color={lowBattery ? colors.text : colors.muted} />
      {/* Hours, not a percentage. Running low reads in graphite and a heavier weight: red stays with SOS and falls. */}
      <Text style={[lowBattery ? s.control : s.muted, styles.tabular]}>
        About {fmtHours(hoursLeft)} of tracking{idle ? '' : ' left'}
      </Text>
    </View>
  ) : null;

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      {/* The page is laid out to fit the screen. It only scrolls if a moment (a fall check) or very large text needs more room. */}
      <ScrollView
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: idle ? tabSpace : space.md }]}
      >
        <View style={styles.top}>
          <View style={styles.state} accessible accessibilityLabel={state ? state.text : today}>
            {state ? <View style={[styles.dot, state.dot === 'hollow' && styles.dotHollow, state.dot === 'quiet' && styles.dotQuiet]} /> : null}
            <Text style={[s.label, state && { color: colors.text }]} numberOfLines={1}>
              {state ? state.text : simulate ? `${today} · Simulated GPS` : today}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/sos')}
            style={styles.sos}
            hitSlop={space.sm}
            accessibilityRole="button"
            accessibilityLabel="Emergency: call for help and show my coordinates"
          >
            <Ionicons name="medkit-outline" size={20} color={colors.danger} />
            <Text style={styles.sosText}>SOS</Text>
          </Pressable>
        </View>

        {idle ? null : (
          <Text style={[s.muted, styles.tabular]}>
            {m.area ? `${m.area.name} · ` : ''}{fmtClock(st?.duration ?? 0)} on the mountain
          </Text>
        )}

        {t.fallAlert ? <Appear key={t.fallAlert.t}><FallCheck /></Appear> : null}
        {t.recovered ? (
          <Appear style={styles.block}>
            <Text style={s.label}>Unfinished day</Text>
            <Text style={s.body}>
              Your day from {t.active ? fmtTimeOfDay(t.active.startedAt) : ''} wasn’t finished. Resume recording or finish it.
            </Text>
          </Appear>
        ) : null}
        {t.finish ? <Appear><FinishNote f={t.finish} /></Appear> : null}
        {t.race && t.status === 'recording' ? <Appear><GhostBar r={t.race} /></Appear> : null}
        {t.jump && t.status === 'recording' ? (
          <Appear style={styles.block}>
            <Text style={s.label}>Jump</Text>
            <Text style={[s.body, styles.tabular]}>
              {fmtAir(t.jump.airtime)} airtime · {fmtJumpHeight(jumpHeight(t.jump.airtime), units)} high
            </Text>
          </Appear>
        ) : null}

        {idle ? (
          <>
            <View style={styles.intro}><MountainIntro m={m} units={units} /></View>
            <Rows>
              <Row label={place ? 'Another place' : 'Search a resort or place'} onPress={() => show('place')} />
              <Row label="Snow and trail map" value={mountainSummary(m, units)} onPress={() => show('mountain')} />
              <Row label="Sport" value={sportInfo(sport).label} onPress={() => show('sport')} />
            </Rows>
            <View style={[styles.startArea, compact && styles.startAreaCompact]}>
              {busy ? <ActivityIndicator color={colors.accent} size="large" /> : (
                <StartButton
                  compact={compact}
                  onPress={() => {
                    haptic('record');
                    run(() => startDay(simulate, sport));
                  }}
                />
              )}
            </View>
            {tracking}
            {simulate ? <Text style={[s.muted, styles.hint]}>Simulated GPS is on (You): a demo day plays at 20× speed.</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.hero}>
              {flash ? (
                <View style={styles.pick}><View style={styles.pickItem}><Text style={[s.label, { color: colors.accent }]}>New top speed</Text></View></View>
              ) : (
                <MetricPick mode={mode} onChange={setMode} />
              )}
              <HeroFigure
                label={flash ? 'New top speed' : MODES.find((x) => x.id === mode)!.label}
                value={hero.value}
                unit={hero.unit}
                color={flash ? colors.accent : colors.text}
              />
              {flash ? <Appear key={flash.at}><View style={styles.rule} /></Appear> : null}
            </View>

            <View style={styles.trio}>
              <Figure style={styles.third} label="Top speed" value={fmtSpeed(st?.topSpeed ?? 0, units, false)} unit={speedUnit(units)} />
              <Figure style={styles.third} label="Vertical" value={fmtAlt(st?.verticalDown ?? 0, units, false)} unit={units === 'metric' ? 'm' : 'ft'} />
              <Figure style={styles.third} label="Runs" value={String(st?.runCount ?? 0)} unit={`${st?.liftCount ?? 0} ${st?.liftCount === 1 ? 'lift' : 'lifts'}`} />
            </View>
            {compact ? null : (
              <View style={styles.trio}>
                <Figure style={styles.third} label="Distance" value={distance} unit={distanceUnit} />
                <Figure
                  style={styles.third}
                  label="Altitude"
                  value={fmtAlt(t.points.length ? t.points[t.points.length - 1].alt : null, units, false)}
                  unit={units === 'metric' ? 'm' : 'ft'}
                />
                <Figure style={styles.third} label="Ski time" value={fmtDuration(st?.skiTime ?? 0)} />
              </View>
            )}

            <View style={styles.rows}>
              <Rows>
                <Row label="Snow and trail map" value={mountainSummary(m, units)} onPress={() => show('mountain')} />
                <Row label="All figures" value="Turns, jumps, lifts" onPress={() => show('figures')} />
              </Rows>
            </View>
            {tracking}
            {t.foregroundOnly && t.status === 'recording' ? (
              <Text style={[s.muted, styles.note]}>Keep the app open: location “All the time” isn’t allowed, so tracking stops with the screen off.</Text>
            ) : null}
          </>
        )}
        {t.error ? <Text style={[s.control, styles.note]}>{t.error}</Text> : null}
      </ScrollView>

      {!idle ? (
        <View style={[styles.footer, { paddingBottom: tabSpace }]} onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}>
          {busy ? <View style={styles.spinner}><ActivityIndicator color={colors.accent} size="large" /></View> : (
            <View style={styles.buttons}>
              {t.status === 'recording'
                ? <Button label="Pause" icon="pause-outline" onPress={() => run(pauseDay)} />
                : <Button label="Resume" icon="play-outline" solid onPress={() => run(resumeDay)} />}
              <HoldButton label="Hold to finish" icon="stop-outline" onHeld={finish} onTap={confirmFinish} />
            </View>
          )}
        </View>
      ) : null}

      {t.lastRun && !idle && !t.race && !t.fallAlert ? <RunDone key={t.lastRun.number} r={t.lastRun} units={units} bottom={footerHeight + space.md} /> : null}

      <Sheet visible={sheetOpen} title={sheetTitle} tall={sheet === 'place' || sheet === 'mountain'} onClose={() => setSheetOpen(false)}>
        {sheet === 'place' ? (
          <PlaceSearch
            units={units}
            current={place}
            onPick={(p) => {
              setPlace(p);
              setSheet('mountain');
            }}
            onUseLocation={() => {
              setPlace(null);
              setSheetOpen(false);
            }}
          />
        ) : sheet === 'mountain' ? (
          <MountainDetails m={m} points={t.points} units={units} />
        ) : sheet === 'sport' ? (
          <SportPicker value={sport} onChange={(sp) => updateSettings({ sport: sp })} />
        ) : (
          <View>
            <Detail label="Distance" value={fmtDist(st?.distance ?? 0, units)} />
            <Detail label="Skied distance" value={fmtDist(st?.skiDistance ?? 0, units)} />
            <Detail label="Altitude now" value={fmtAlt(t.points.length ? t.points[t.points.length - 1].alt : null, units)} />
            <Detail label="Highest point" value={fmtAlt(st?.maxAlt, units)} />
            <Detail label="Ski time" value={fmtDuration(st?.skiTime ?? 0)} />
            <Detail label="Lift time" value={fmtDuration(st?.liftTime ?? 0)} />
            <Detail label="Lift lines" value={fmtDuration(st?.liftWaitTime ?? 0)} />
            <Detail label="Turns" value={String(st?.turns ?? 0)} />
            {st?.maxG ? <Detail label="Strongest turn" value={fmtG(st.maxG)} /> : null}
            <Detail label="Jumps" value={String(t.motion.jumps)} />
            {t.motion.bestAir ? <Detail label="Longest air" value={fmtAir(t.motion.bestAir)} /> : null}
            <Detail label="Falls" value={String(t.motion.falls)} />
            {t.motionLive ? <Text style={[s.muted, styles.note]}>Jumps and falls are picked up while the app is open on screen.</Text> : null}
          </View>
        )}
      </Sheet>

      {/* New badges, in the app's own voice instead of a system dialog. The badge emoji stay: they are the badges. */}
      <Sheet visible={!!earned} title={earned?.badges.length === 1 ? 'New badge' : `${earned?.badges.length ?? 0} new badges`} onClose={seeDay}>
        {earned?.badges.map((b) => (
          <View key={b.id} style={styles.badge}>
            <Text style={styles.badgeMark} allowFontScaling={false}>{b.emoji}</Text>
            <View style={styles.grow}>
              <Text style={s.control}>{b.title}</Text>
              <Text style={s.muted}>{b.description}</Text>
            </View>
          </View>
        ))}
        <View style={styles.close}><Button label="See your day" solid onPress={seeDay} /></View>
      </Sheet>
    </View>
  );
}

/** Speed, Vertical or Time: the underline slides from the label you tapped. */
function MetricPick({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const [spots, setSpots] = useState<Partial<Record<Mode, { x: number; w: number }>>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  const spot = spots[mode];
  useEffect(() => {
    if (!spot) return;
    const centre = spot.x + spot.w / 2;
    if (placed.current) {
      x.value = withTiming(centre, { duration: motion.micro, easing: easeOut });
      w.value = withTiming(spot.w, { duration: motion.micro, easing: easeOut });
    } else {
      x.value = centre;
      w.value = spot.w;
      placed.current = true;
    }
  }, [spot, x, w]);
  const line = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { scaleX: w.value }] }));
  return (
    <View style={styles.pick} accessibilityRole="tablist">
      {MODES.map((mo) => {
        const on = mo.id === mode;
        return (
          <Pressable
            key={mo.id}
            style={styles.pickItem}
            onLayout={(e) => {
              const { x: left, width } = e.nativeEvent.layout;
              setSpots((p) => ({ ...p, [mo.id]: { x: left, w: width } }));
            }}
            onPress={() => {
              if (!on) haptic('select');
              onChange(mo.id);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={mo.label}
          >
            <Text style={[s.label, on && { color: colors.text }]}>{mo.label}</Text>
          </Pressable>
        );
      })}
      <Animated.View style={[styles.pickLine, line]} />
    </View>
  );
}

/** One very large, light figure with its unit small beside it. It takes the room the page has left, and shrinks to fit long values. */
function HeroFigure({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  const styles = useStyles(makeStyles);
  const { width } = useWindowDimensions();
  const [room, setRoom] = useState<number>(size.hero);
  // Tabular digits are about 0.64 em wide, separators about half that.
  const ems = value.split('').reduce((n, c) => n + (c >= '0' && c <= '9' ? 0.64 : 0.32), 0);
  const fits = Math.floor((width - 2 * space.xl - space.xxxl - space.lg) / Math.max(ems, 1));
  const fontSize = Math.max(size.figure, Math.min(size.hero, fits, Math.floor(room / 1.1)));
  return (
    <View
      style={styles.bigBox}
      onLayout={(e) => setRoom(e.nativeEvent.layout.height)}
      accessible
      accessibilityLabel={`${label}: ${value} ${unit}`}
    >
      <View style={styles.big} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <RollingNumber
          value={value}
          height={Math.round(fontSize * 1.1)}
          style={[styles.heroText, { fontSize, letterSpacing: -0.02 * fontSize, color }]}
        />
        <Text style={styles.heroUnit} maxFontSizeMultiplier={1.2}>{unit}</Text>
      </View>
    </View>
  );
}

/** The one solid control on the tab, glove-sized, with a slow breathing ring: the only motion while idle. */
function StartButton({ onPress, compact }: { onPress: () => void; compact: boolean }) {
  const styles = useStyles(makeStyles);
  const focused = useIsFocused();
  const breath = useSharedValue(0);
  useEffect(() => {
    if (!focused) return;
    breath.value = withRepeat(withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(breath);
  }, [focused, breath]);
  const inner = useAnimatedStyle(() => ({ opacity: 0.3 + 0.7 * breath.value, transform: [{ scale: 0.97 + 0.06 * breath.value }] }));
  const outer = useAnimatedStyle(() => ({ opacity: 0.15 + 0.45 * breath.value, transform: [{ scale: 0.97 + 0.06 * breath.value }] }));
  return (
    <View style={styles.startWrap}>
      {compact ? null : <Animated.View style={[styles.ring, styles.ringOuter, outer]} />}
      <Animated.View style={[styles.ring, styles.ringInner, inner]} />
      <Tap onPress={onPress} style={styles.start} accessibilityRole="button" accessibilityLabel="Start recording your day">
        <Text style={styles.startText} maxFontSizeMultiplier={1.4}>Start</Text>
      </Tap>
    </View>
  );
}

function Button({ label, icon, onPress, solid, danger }: { label: string; icon?: IconName; onPress: () => void; solid?: boolean; danger?: boolean }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  // Text on the solid and the danger fill uses the background colour, so it reads in light and dark.
  const ink = danger || solid ? colors.bg : colors.text;
  return (
    <Tap
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.button, solid && styles.buttonSolid, danger && { backgroundColor: colors.danger }]}
    >
      {icon ? <Ionicons name={icon} size={24} color={ink} /> : null}
      <Text style={[s.control, { color: ink }]} maxFontSizeMultiplier={1.4}>{label}</Text>
    </Tap>
  );
}

/** Finishing needs a held press: the button fills from the left while you hold, and lets go faster than it fills. */
function HoldButton({ label, icon, onHeld, onTap }: { label: string; icon: IconName; onHeld: () => void; onTap: () => void }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const [width, setWidth] = useState(0);
  const fill = useSharedValue(0);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (fill.value - 1) * width }] }));
  return (
    <Pressable
      style={styles.button}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPressIn={() => { fill.value = withTiming(1, { duration: motion.hold, easing: Easing.linear }); }}
      onPressOut={() => { fill.value = withTiming(0, { duration: motion.micro, easing: easeOut }); }}
      delayLongPress={motion.hold}
      onLongPress={onHeld}
      onPress={onTap}
      accessibilityRole="button"
      accessibilityLabel="Finish your day"
      accessibilityHint="Hold for one second, or tap and confirm"
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.holdFill, fillStyle]} />
      <Ionicons name={icon} size={24} color={colors.text} />
      <Text style={s.control} maxFontSizeMultiplier={1.4}>{label}</Text>
    </Pressable>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.detail} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={[s.body, { color: colors.muted }]}>{label}</Text>
      <Text style={[s.body, styles.tabular]}>{value}</Text>
    </View>
  );
}

/**
 * The run you just finished, shown while you ride the next lift. It floats above the
 * controls instead of covering the screen, so Pause, Finish and SOS stay reachable.
 */
function RunDone({ r, units, bottom }: { r: RunSummary; units: Units; bottom: number }) {
  const { s, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const drag = useSharedValue(0);
  // The card follows your finger down; let go past a third of it and it leaves, otherwise it settles back.
  const pan = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { drag.set(Math.max(0, g.dy)); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 96) dismissLastRun();
        else drag.set(withSpring(0, motion.spring));
      },
      onPanResponderTerminate: () => { drag.set(withSpring(0, motion.spring)); },
    }),
    [drag],
  );
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));
  const name = r.piste?.name ?? `Run ${r.number}`;
  const grade = r.piste ? difficultyLabel(r.piste.difficulty) : null;
  return (
    <Animated.View
      entering={SlideInDown.springify().damping(motion.spring.damping).stiffness(motion.spring.stiffness).mass(motion.spring.mass)}
      exiting={SlideOutDown.duration(motion.enter).easing(easeOut)}
      style={[styles.sheetWrap, { bottom }]}
      pointerEvents="box-none"
    >
      <Animated.View {...pan.panHandlers} style={[styles.sheet, { boxShadow: chromeShadow(dark) }, dragStyle]}>
        <View style={styles.grab} />
        <Text
          style={s.label}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Run done. ${name}, ${fmtClock(r.duration)}, ${fmtAlt(r.verticalDown, units)} down.`}
        >
          {r.piste?.name ? `Run ${r.number} done` : 'Run done'}
        </Text>
        <View style={styles.title}>
          {r.piste?.difficulty ? <View style={[styles.pisteDot, { backgroundColor: difficultyColor(r.piste.difficulty, dark) }]} /> : null}
          <Text style={[s.h1, styles.grow]} numberOfLines={1}>{name}</Text>
        </View>
        <Text style={[s.muted, styles.tabular]}>{[grade ? `${grade} piste` : null, fmtDist(r.distance, units)].filter(Boolean).join(' · ')}</Text>
        <View style={styles.trio}>
          <Figure style={styles.third} label="Time" value={fmtClock(r.duration)} />
          <Figure style={styles.third} label="Top speed" value={fmtSpeed(r.topSpeed, units, false)} unit={speedUnit(units)} />
          <Figure style={styles.third} label="Vertical" value={fmtAlt(r.verticalDown, units, false)} unit={units === 'metric' ? 'm' : 'ft'} />
        </View>
        <View style={styles.close}><Button label="Close" onPress={dismissLastRun} /></View>
      </Animated.View>
    </Animated.View>
  );
}

/** Live challenge: your time, and a thin bar that reads ahead (glacier) or behind (muted). */
function GhostBar({ r }: { r: LiveRace }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const ahead = r.delta != null && r.delta < 0;
  const tone = ahead ? colors.accent : colors.muted;
  return (
    <View style={styles.block} accessible>
      <Text style={s.label} numberOfLines={1}>
        {r.name}{r.delta != null ? ` · vs ${r.rivalIsMe ? 'your best' : r.rivalName}` : ''}
      </Text>
      <View style={styles.between}>
        <Text style={s.figure}>{fmtRaceTime(r.elapsed)}</Text>
        {r.delta != null
          ? <Text style={[s.figure, { color: tone }]}>{fmtDelta(r.delta)}</Text>
          : <Text style={s.muted}>First time. Set the time to beat.</Text>}
      </View>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${Math.round(r.progress * 100)}%`, backgroundColor: tone }]} />
      </View>
    </View>
  );
}

/** What to say when you cross the finish line: short, warm, precise. */
function finishMessage(f: RaceFinish): string {
  const gap = f.rivalGap != null ? Math.abs(f.rivalGap).toFixed(1) : '';
  if (f.rivalName && f.rivalGap != null) {
    if (f.rivalIsMe) return f.rivalGap < 0 ? `New personal best, ${gap}s faster.` : `${fmtDelta(f.rivalGap)} off your best.`;
    if (f.rivalGap < 0) return `You beat ${f.rivalName} by ${gap}s${f.rank === 1 ? ' and took the lead.' : '.'}`;
    return `${fmtDelta(f.rivalGap)} behind ${f.rivalName}${f.isPersonalBest && f.previousBest != null ? ', and a new personal best.' : '.'}`;
  }
  if (f.previousBest == null) return 'Your first time. Challenge a friend to beat it.';
  return f.isPersonalBest ? `New personal best. It was ${fmtRaceTime(f.previousBest)}.` : 'Not your best. Go again.';
}

function FinishNote({ f }: { f: RaceFinish }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.block}>
      <View style={styles.between}>
        <Text style={[s.label, styles.grow]} numberOfLines={1}>{f.name}</Text>
        <Pressable onPress={dismissFinish} style={styles.icon} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Ionicons name="close-outline" size={24} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={s.figure}>{f.of > 1 ? `${fmtRaceTime(f.time)} · ${f.rank} of ${f.of}` : fmtRaceTime(f.time)}</Text>
      <Text style={s.body}>{finishMessage(f)}</Text>
      {f.splitNote ? <Text style={s.muted}>{f.splitNote}</Text> : null}
      <Pressable onPress={() => router.push(`/segment/${f.segmentId}`)} style={styles.link} accessibilityRole="link">
        <Text style={[s.control, { color: colors.accent }]}>See the leaderboard</Text>
      </Pressable>
    </View>
  );
}

const FALL_CHECK_SECONDS = 60;

/** After a fall: are you OK? No answer opens the SOS screen. Clarity comes before style here. */
function FallCheck() {
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
    <View style={styles.fall}>
      <View style={styles.between}>
        <Text style={[s.h1, { color: colors.danger }]}>Are you OK?</Text>
        <Text style={s.figure}>{left} s</Text>
      </View>
      <Text style={s.body}>That looked like a hard fall. If you don’t answer, the SOS screen opens with your position.</Text>
      <View style={styles.buttons}>
        <Button label="I’m OK" icon="checkmark-outline" solid onPress={dismissFall} />
        <Button label="Get help" icon="medkit-outline" danger onPress={() => { dismissFall(); router.push('/sos'); }} />
      </View>
      <Pressable onPress={() => { notAFall().catch(() => undefined); }} style={[styles.link, styles.centerSelf]} accessibilityRole="button">
        <Text style={[s.control, { color: colors.accent }]}>That wasn’t a fall</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    // flexGrow: the page fills the screen exactly, and the Start button or the big figure takes what is left.
    content: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.sm },
    top: { minHeight: target.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg, marginBottom: space.xs },
    state: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
    dotHollow: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.accent },
    dotQuiet: { backgroundColor: colors.muted },
    // Outlined, not a filled alarm: calm, but one tap away in every state. The 73 is 45% alpha.
    sos: {
      height: target.min, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.md, paddingRight: space.lg,
      borderRadius: radius.pill, borderWidth: 1, borderColor: `${colors.danger}73`,
    },
    sosText: { fontFamily: font.medium, fontSize: size.caption, letterSpacing: 1, color: colors.danger },
    tabular: { fontVariant: ['tabular-nums'] },
    hint: { textAlign: 'center', marginTop: space.sm },
    note: { marginTop: space.md },
    centerSelf: { alignSelf: 'center' },
    grow: { flex: 1 },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
    block: { gap: space.xs, paddingVertical: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.faint },
    icon: { width: target.min, height: target.min, alignItems: 'flex-end', justifyContent: 'center' },
    link: { minHeight: target.min, justifyContent: 'center', alignSelf: 'flex-start' },

    intro: { marginTop: space.lg, marginBottom: space.lg },
    // Room for the rings (32 around the button); the button centres in whatever height is left.
    startArea: { flexGrow: 1, minHeight: target.start + 2 * space.xxxl, alignItems: 'center', justifyContent: 'center' },
    startAreaCompact: { minHeight: target.start + 2 * space.xl },
    startWrap: { width: target.start, height: target.start },
    ring: { position: 'absolute', borderRadius: radius.pill, borderColor: colors.ice },
    ringInner: { top: -space.lg, right: -space.lg, bottom: -space.lg, left: -space.lg, borderWidth: 1.5 },
    ringOuter: { top: -space.xxl, right: -space.xxl, bottom: -space.xxl, left: -space.xxl, borderWidth: 1 },
    start: { width: target.start, height: target.start, borderRadius: target.start / 2, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
    startText: { fontFamily: font.medium, fontSize: size.control, color: colors.bg },

    hero: { flexGrow: 1, marginTop: space.md },
    pick: { flexDirection: 'row', gap: space.xl, height: target.min },
    pickItem: { height: target.min, justifyContent: 'center' },
    pickLine: { position: 'absolute', left: -0.5, bottom: space.sm, width: 1, height: 2, backgroundColor: colors.ice },
    bigBox: { flexGrow: 1, minHeight: 64, justifyContent: 'center' },
    big: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
    heroText: { fontFamily: font.light, fontVariant: ['tabular-nums'], includeFontPadding: false },
    heroUnit: { fontFamily: font.regular, fontSize: size.control, color: colors.muted },
    rule: { height: 2, backgroundColor: colors.ice },
    trio: { flexDirection: 'row', gap: space.lg, marginTop: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faint },
    third: { flex: 1 },
    rows: { marginTop: space.lg },
    detail: { minHeight: space.xxl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
    battery: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },

    footer: { paddingHorizontal: space.xl, paddingTop: space.md, backgroundColor: colors.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faint },
    spinner: { height: target.control, alignItems: 'center', justifyContent: 'center' },
    buttons: { flexDirection: 'row', gap: space.md },
    // Glove-sized. Tonal by default, so the live figure stays the only high-contrast thing on screen.
    button: {
      flex: 1, height: target.control, borderRadius: radius.card, backgroundColor: colors.faint, overflow: 'hidden',
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    },
    buttonSolid: { backgroundColor: colors.text },
    holdFill: { backgroundColor: colors.text, opacity: 0.14 },

    sheetWrap: { position: 'absolute', left: space.lg, right: space.lg },
    sheet: {
      backgroundColor: colors.card, borderRadius: radius.card, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xl,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.faint, gap: space.xs,
    },
    grab: { alignSelf: 'center', width: space.xxl, height: 4, borderRadius: 2, backgroundColor: colors.faint, marginBottom: space.md },
    title: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
    pisteDot: { width: 12, height: 12, borderRadius: 6 },
    close: { height: 64, flexDirection: 'row', marginTop: space.lg },
    badge: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: 56 },
    badgeMark: { fontSize: 32, width: space.xxxl, textAlign: 'center' },

    track: { height: 2, backgroundColor: colors.faint, marginTop: space.sm },
    trackFill: { height: 2 },
    fall: { gap: space.md, padding: space.lg, marginTop: space.sm, borderRadius: radius.card, borderWidth: 1.5, borderColor: colors.danger },
  });
