import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Stack from 'expo-router/stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { shareChallenge } from '../../challenges/service';
import { SegmentMap } from '../../components/SegmentMap';
import { deleteSegment, getSegment, listAttempts } from '../../db';
import { fmtAlt, fmtDate, fmtDelta, fmtDist, fmtRaceTime } from '../../lib/format';
import { leaderboard, pathInfo, type Attempt, type Segment } from '../../lib/segments';
import { useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';
import { refreshRacers } from '../../tracking/tracker';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function SegmentScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { units, playerId, name } = useSettings();
  const [segment, setSegment] = useState<Segment | null | undefined>(undefined);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sharing, setSharing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getSegment(id).then(setSegment);
      listAttempts(id).then(setAttempts);
    }, [id]),
  );

  if (segment === undefined) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;
  if (segment === null) return <Text style={[s.muted, { padding: 24 }]}>This challenge was deleted.</Text>;

  const info = pathInfo(segment.path);
  const board = leaderboard(attempts);
  const mine = attempts.filter((a) => a.playerId === playerId).sort((a, b) => b.at - a.at);
  const myBest = board.find((e) => e.playerId === playerId);
  const leader = board[0];

  const invite = async () => {
    if (!name.trim()) {
      Alert.alert('What’s your name?', 'Add your name in Profile so your friend knows who challenged them.', [
        { text: 'Later', style: 'cancel', onPress: () => doShare() },
        { text: 'Set name', onPress: () => router.push('/profile') },
      ]);
      return;
    }
    await doShare();
  };
  const doShare = async () => {
    setSharing(true);
    try {
      await shareChallenge(segment.id);
    } finally {
      setSharing(false);
    }
  };

  const remove = () =>
    Alert.alert('Delete this challenge?', 'Your times on it are deleted too. Friends keep their copy.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSegment(segment.id);
          await refreshRacers();
          router.back();
        },
      },
    ]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: segment.name,
          headerRight: () => (
            <Pressable onPress={remove} hitSlop={10} accessibilityLabel="Delete challenge">
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
            </Pressable>
          ),
        }}
      />

      <SegmentMap path={segment.path} gateRadius={segment.gateRadius} />
      <Text style={s.muted}>
        {fmtDist(info.length, units)}{info.drop != null ? ` · ↓ ${fmtAlt(info.drop, units)}` : ''}
        {segment.creatorName ? ` · made by ${segment.creatorName}` : ''}
      </Text>

      <View style={[s.card, styles.hero]}>
        {myBest ? (
          <>
            <Text style={s.label}>Your best</Text>
            <Text style={styles.big}>{fmtRaceTime(myBest.time)}</Text>
            <Text style={s.muted}>
              {myBest.rank === 1
                ? board.length > 1 ? `You’re the fastest of ${board.length}! Defend it.` : 'Send it to a friend and see if they can beat it.'
                : `#${myBest.rank} of ${board.length} · ${fmtDelta(myBest.time - leader.time)} behind ${leader.playerName}`}
            </Text>
          </>
        ) : (
          <>
            <Text style={s.label}>Time to beat</Text>
            <Text style={styles.big}>{leader ? fmtRaceTime(leader.time) : '–'}</Text>
            <Text style={[s.muted, { textAlign: 'center' }]}>
              {leader ? `Set by ${leader.playerName}. ` : ''}Start recording and ski it: you’re timed automatically, with a
              live ghost to race against.
            </Text>
          </>
        )}
      </View>

      <Pressable onPress={invite} disabled={sharing} style={({ pressed }) => [styles.invite, pressed && { opacity: 0.85 }]}>
        {sharing ? <ActivityIndicator color={colors.onAccent} /> : (
          <>
            <Ionicons name="paper-plane" size={20} color={colors.onAccent} />
            <Text style={styles.inviteText}>{myBest && board.length > 1 && myBest.rank > 1 ? 'Send my time back' : 'Challenge a friend'}</Text>
          </>
        )}
      </Pressable>

      <Text style={[s.h2, { marginTop: 8 }]}>Leaderboard</Text>
      {board.length === 0 ? <Text style={s.muted}>No times yet.</Text> : null}
      {board.map((e) => {
        const me = e.playerId === playerId;
        return (
          <View key={e.playerId} style={[s.card, styles.lbRow, me && { borderColor: colors.accent }]}>
            <Text style={styles.rank}>{MEDALS[e.rank - 1] ?? `#${e.rank}`}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.body, { fontWeight: '700' }]}>{me ? `${e.playerName} (you)` : e.playerName}</Text>
              <Text style={s.muted}>{fmtDate(e.at)}{e.attempts > 1 ? ` · ${e.attempts} runs` : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.lbTime}>{fmtRaceTime(e.time)}</Text>
              {e.rank > 1 ? <Text style={s.muted}>{fmtDelta(e.time - leader.time)}</Text> : null}
            </View>
          </View>
        );
      })}

      {mine.length ? <Text style={[s.h2, { marginTop: 8 }]}>Your runs</Text> : null}
      {mine.map((a) => (
        <Pressable
          key={a.id}
          disabled={!a.sessionId}
          onPress={() => a.sessionId && router.push(`/day/${a.sessionId}`)}
          style={styles.attempt}
        >
          <Text style={s.body}>{fmtDate(a.at)}</Text>
          <Text style={[styles.lbTime, { fontSize: 15 }]}>
            {a.id === myBest?.id ? '⭐ ' : ''}{fmtRaceTime(a.time)}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    hero: { alignItems: 'center', gap: 4, paddingVertical: 20 },
    big: { fontSize: 44, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'] },
    invite: { flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16 },
    inviteText: { color: colors.onAccent, fontSize: 18, fontWeight: '800' },
    lbRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: 'transparent', paddingVertical: 12 },
    rank: { fontSize: 22, width: 36, textAlign: 'center', fontWeight: '800', color: colors.muted },
    lbTime: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
    attempt: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.faint },
  });
