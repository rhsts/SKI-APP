import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fmtDate, fmtDelta, fmtRaceTime } from '../lib/format';
import { compareSplits, pointAlong, progressAt, SECTION_NAMES } from '../lib/ghost';
import { ghostTimeAt, GHOST_SAMPLES, leaderboard, type Attempt, type Segment } from '../lib/segments';
import { useStyles, useTheme, type Palette } from '../theme';
import { SegmentMap } from './SegmentMap';

interface Props {
  segment: Segment;
  attempts: Attempt[];
  playerId: string;
}

const ME = '#0B6BCB';
const RIVAL = '#E8892B';
const REPLAY_SPEED = 4; // 4× real time
const TICK_MS = 50;

interface Runner {
  id: string;
  label: string;
  sub: string;
  attempt: Attempt & { ghost: number[] };
}

const hasGhost = (a: Attempt): a is Attempt & { ghost: number[] } => !!a.ghost && a.ghost.length === GHOST_SAMPLES + 1;

/**
 * Race replay: your best run and a rival's run as two dots racing down the
 * course, plus split times showing where the time was won or lost.
 */
export function RaceReplay({ segment, attempts, playerId }: Props) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);

  const { me, rivals } = useMemo(() => {
    const mine = attempts.filter((a) => a.playerId === playerId && hasGhost(a)).sort((a, b) => a.time - b.time);
    const best = mine[0] as Runner['attempt'] | undefined;
    const others: Runner[] = leaderboard(attempts)
      .filter((e) => e.playerId !== playerId && hasGhost(e))
      .map((e) => ({ id: e.id, label: e.playerName, sub: fmtRaceTime(e.time), attempt: e as Runner['attempt'] }));
    // Your own earlier runs, so you can race yourself.
    const self: Runner[] = mine.slice(1, 4).map((a) => ({
      id: a.id, label: 'You', sub: `${fmtRaceTime(a.time)} · ${fmtDate(a.at).slice(4)}`, attempt: a as Runner['attempt'],
    }));
    return { me: best ? { id: best.id, label: 'You', sub: fmtRaceTime(best.time), attempt: best } : null, rivals: [...others, ...self] };
  }, [attempts, playerId]);

  const [rivalId, setRivalId] = useState<string | null>(null);
  const rival = rivals.find((r) => r.id === rivalId) ?? rivals[0] ?? null;
  const [t, setT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const end = Math.max(me?.attempt.time ?? 0, rival?.attempt.time ?? 0);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setT((cur) => {
        const next = (cur ?? 0) + (TICK_MS / 1000) * REPLAY_SPEED;
        if (next >= end) {
          setPlaying(false);
          return end;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, end]);

  const runners = [me, rival].filter((r): r is Runner => !!r);
  const markers = t == null ? [] : runners.map((r, i) => {
    const p = pointAlong(segment.path, progressAt(r.attempt.ghost, t));
    const label = r === me ? 'You' : r.label === 'You' ? 'Old you' : r.label;
    return { key: `${i}-${r.id}`, lat: p.lat, lon: p.lon, color: i === 0 && me ? ME : RIVAL, label };
  });

  // Who's ahead right now, in seconds.
  let status = 'Press play to race the ghosts';
  if (t != null && me && rival) {
    const pm = progressAt(me.attempt.ghost, t), pr = progressAt(rival.attempt.ghost, t);
    const name = rival.label === 'You' ? 'your old run' : rival.label;
    if (t >= end) status = me.attempt.time <= rival.attempt.time ? `You win by ${(rival.attempt.time - me.attempt.time).toFixed(1)}s` : `${rival.label === 'You' ? 'Your old run' : rival.label} wins by ${(me.attempt.time - rival.attempt.time).toFixed(1)}s`;
    else if (pr > pm) status = `${fmtRaceTime(t)} · ${(ghostTimeAt(me.attempt.ghost, pr) - t).toFixed(1)}s behind ${name}`;
    else status = `${fmtRaceTime(t)} · ${(ghostTimeAt(rival.attempt.ghost, pm) - t).toFixed(1)}s ahead of ${name}`;
  } else if (t != null) {
    status = fmtRaceTime(t);
  }

  const splits = me && rival ? compareSplits(me.attempt.ghost, rival.attempt.ghost) : null;

  return (
    <View style={{ gap: 10 }}>
      <SegmentMap path={segment.path} gateRadius={segment.gateRadius} markers={markers} />

      {runners.length ? (
        <View style={[s.card, { gap: 10 }]}>
          <View style={styles.playRow}>
            <Pressable
              onPress={() => {
                if (!playing && (t == null || t >= end)) setT(0);
                setPlaying(!playing);
              }}
              style={styles.play}
              accessibilityLabel={playing ? 'Pause race replay' : 'Play race replay'}
            >
              <Ionicons name={playing ? 'pause' : 'play'} size={22} color={colors.onAccent} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Race replay · {REPLAY_SPEED}× speed</Text>
              <Text style={s.body}>{status}</Text>
            </View>
          </View>

          {rivals.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {rivals.map((r) => {
                const on = r.id === rival?.id;
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => { setRivalId(r.id); setT(null); setPlaying(false); }}
                    style={[styles.chip, on && { backgroundColor: RIVAL, borderColor: RIVAL }]}
                  >
                    <Text style={[styles.chipText, on && { color: '#fff' }]}>vs {r.label} · {r.sub}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {splits ? (
            <View style={styles.splits}>
              <View style={styles.splitRow}>
                <Text style={[s.label, styles.splitName]}>Section</Text>
                <Text style={[s.label, styles.splitVal, { color: colors.accent }]}>You</Text>
                <Text style={[s.label, styles.splitVal, { color: RIVAL }]} numberOfLines={1}>{rival!.label === 'You' ? 'Old you' : rival!.label}</Text>
                <Text style={[s.label, styles.splitVal]}>Gap</Text>
              </View>
              {splits.deltas.map((d, i) => (
                <View key={i} style={[styles.splitRow, i === splits.worst && { backgroundColor: colors.warnSoft }]}>
                  <Text style={[s.body, styles.splitName]}>{SECTION_NAMES[i][0].toUpperCase() + SECTION_NAMES[i].slice(1)}</Text>
                  <Text style={[s.body, styles.splitVal]}>{splits.mine[i].toFixed(1)}s</Text>
                  <Text style={[s.body, styles.splitVal]}>{splits.theirs[i].toFixed(1)}s</Text>
                  <Text style={[s.body, styles.splitVal, { fontWeight: '800', color: d > 0.05 ? colors.danger : d < -0.05 ? colors.good : colors.muted }]}>
                    {fmtDelta(d)}
                  </Text>
                </View>
              ))}
              {splits.worst != null ? (
                <Text style={s.muted}>You lose the most time in the {SECTION_NAMES[splits.worst]} section.</Text>
              ) : (
                <Text style={s.muted}>You’re faster in every section. 💪</Text>
              )}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    playRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: colors.faint },
    chipText: { fontWeight: '700', color: colors.text, fontSize: 13 },
    splits: { gap: 2 },
    splitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6 },
    splitName: { flex: 1.2 },
    splitVal: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  });
