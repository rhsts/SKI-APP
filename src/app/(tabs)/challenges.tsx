import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { listAttempts, listSegments } from '../../db';
import { fmtAlt, fmtDist, fmtRaceTime } from '../../lib/format';
import { leaderboard, pathInfo, type LeaderboardEntry, type Segment } from '../../lib/segments';
import { extractCode } from '../../lib/share';
import { useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';

interface Row {
  segment: Segment;
  board: LeaderboardEntry[];
  mine: LeaderboardEntry | undefined;
  length: number;
  drop: number | null;
}

export default function ChallengesScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units, playerId } = useSettings();
  const [rows, setRows] = useState<Row[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [segments, attempts] = await Promise.all([listSegments(), listAttempts()]);
        setRows(
          segments.map((segment) => {
            const board = leaderboard(attempts.filter((a) => a.segmentId === segment.id));
            return { segment, board, mine: board.find((e) => e.playerId === playerId), ...pathInfo(segment.path) };
          }),
        );
      })().catch(() => setRows([]));
    }, [playerId]),
  );

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    const code = extractCode(text ?? '');
    if (!code) {
      Alert.alert('No invite found', 'Copy the whole invite message (or link) your friend sent you, then tap Paste invite again.');
      return;
    }
    router.push({ pathname: '/c', params: { d: code } });
  };

  if (!rows) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={(r) => r.segment.id}
      ListHeaderComponent={
        <Pressable style={({ pressed }) => [styles.paste, pressed && { opacity: 0.8 }]} onPress={paste}>
          <Ionicons name="clipboard-outline" size={18} color={colors.accent} />
          <Text style={styles.pasteText}>Paste invite from a friend</Text>
        </Pressable>
      }
      ListEmptyComponent={
        <View style={[s.card, styles.empty]}>
          <Ionicons name="flag-outline" size={40} color={colors.accent} />
          <Text style={s.h2}>No challenges yet</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Open a ski day in Days and tap the flag on a run to turn it into a challenge. Then send it to a friend
            and try to beat each other’s time.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const leader = item.board[0];
        const iLead = leader && leader.playerId === playerId;
        return (
          <Pressable
            style={({ pressed }) => [s.card, styles.row, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(`/segment/${item.segment.id}`)}
          >
            <View style={[styles.badge, { backgroundColor: iLead ? colors.warnSoft : colors.accentSoft }]}>
              <Ionicons name={iLead ? 'trophy' : 'flag'} size={20} color={iLead ? colors.warn : colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.h2} numberOfLines={1}>{item.segment.name}</Text>
              <Text style={s.muted}>
                {fmtDist(item.length, units)}{item.drop != null ? ` · ↓ ${fmtAlt(item.drop, units)}` : ''}
                {item.board.length > 1 ? ` · ${item.board.length} skiers` : ''}
              </Text>
              <View style={styles.times}>
                <Text style={styles.time}>You: {item.mine ? fmtRaceTime(item.mine.time) : '–'}</Text>
                {leader && !iLead ? (
                  <Text style={[styles.time, { color: colors.muted }]}>
                    Best: {leader.playerName} {fmtRaceTime(leader.time)}
                  </Text>
                ) : null}
                {iLead && item.board.length > 1 ? <Text style={[styles.time, { color: colors.warn }]}>You lead!</Text> : null}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </Pressable>
        );
      }}
    />
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    list: { padding: 16, gap: 10 },
    paste: {
      flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 12,
      borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent, borderStyle: 'dashed', marginBottom: 4,
    },
    pasteText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
    empty: { alignItems: 'center', gap: 10, paddingVertical: 32 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    times: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
    time: { fontSize: 14, fontWeight: '700', color: colors.text },
  });
