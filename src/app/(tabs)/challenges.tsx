import { Tap } from '../../components/Tap';
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
import { cachedChallenges, cachedGroups, syncFriends, type CachedChallenge } from '../../friends/sync';
import type { Group } from '../../lib/groups';
import { localDate } from '../../lib/groups';
import { useTheme, useStyles, type Palette } from '../../theme';
import { useTabBarSpace } from '../../components/TabBar';

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
  const tabSpace = useTabBarSpace();
  const { units, playerId, serverUrl } = useSettings();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupChallenges, setGroupChallenges] = useState<CachedChallenge[]>([]);
  const [today, setToday] = useState('');

  useFocusEffect(
    useCallback(() => {
      let live = true;
      setToday(localDate(Date.now()));
      if (!serverUrl) {
        setGroups([]);
        setGroupChallenges([]);
        return;
      }
      const fromCache = () =>
        Promise.all([cachedGroups(), cachedChallenges()]).then(([g, c]) => {
          if (!live) return;
          setGroups(g);
          setGroupChallenges(c);
        });
      fromCache().then(() => syncFriends()).then(fromCache).catch(() => undefined);
      return () => { live = false; };
    }, [serverUrl]),
  );

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
      contentContainerStyle={[styles.list, { paddingBottom: tabSpace }]}
      data={rows}
      keyExtractor={(r) => r.segment.id}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 4 }}>
          <View style={styles.groupsHead}>
            <Text style={s.h2}>Friend groups</Text>
            <Pressable onPress={() => router.push('/group/new')} hitSlop={8}>
              <Text style={styles.link}>{serverUrl ? '+ New / join' : 'Set up'}</Text>
            </Pressable>
          </View>
          {!serverUrl ? (
            <Pressable style={[s.card, styles.row]} onPress={() => router.push('/group/new')}>
              <Ionicons name="people-outline" size={24} color={colors.accent} />
              <Text style={[s.muted, { flex: 1 }]}>
                Make a group for your ski trip: a daily leaderboard and group challenges. Needs a friends server (Profile).
              </Text>
            </Pressable>
          ) : !groups.length ? (
            <Pressable style={[s.card, styles.row]} onPress={() => router.push('/group/new')}>
              <Ionicons name="people-outline" size={24} color={colors.accent} />
              <Text style={[s.muted, { flex: 1 }]}>No groups yet. Start one for your trip, or join with a friend’s code.</Text>
            </Pressable>
          ) : (
            groups.map((g) => {
              const todays = groupChallenges.filter((c) => c.groupId === g.id && c.date === today);
              return (
                <Tap key={g.id} style={[s.card, styles.row]} onPress={() => router.push(`/group/${g.id}`)}>
                  <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
                    <Ionicons name="people" size={20} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.h2} numberOfLines={1}>{g.name}</Text>
                    <Text style={s.muted} numberOfLines={1}>
                      {g.members} {g.members === 1 ? 'skier' : 'skiers'}
                      {todays.length ? ` · 🏁 today: ${todays.map((c) => c.name).join(', ')}` : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </Tap>
              );
            })
          )}
          <Text style={[s.h2, { marginTop: 8 }]}>Challenges</Text>
          <Tap style={styles.paste} onPress={paste}>
            <Ionicons name="clipboard-outline" size={18} color={colors.accent} />
            <Text style={styles.pasteText}>Paste invite from a friend</Text>
          </Tap>
        </View>
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
          <Tap
            style={[s.card, styles.row]}
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
              {groupChallenges.some((c) => c.segmentId === item.segment.id) ? (
                <Text style={[s.muted, { color: colors.accent, fontWeight: '600' }]} numberOfLines={1}>
                  👥 {[...new Set(groupChallenges.filter((c) => c.segmentId === item.segment.id).map((c) => c.groupName))].join(', ')}
                </Text>
              ) : null}
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
          </Tap>
        );
      }}
    />
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    list: { padding: 16, gap: 12 },
    paste: {
      flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 12,
      borderRadius: 12, borderWidth: 1, borderColor: colors.accent, borderStyle: 'dashed', marginBottom: 4,
    },
    groupsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    link: { color: colors.accent, fontWeight: '700', fontSize: 15 },
    pasteText: { color: colors.accent, fontWeight: '600', fontSize: 15 },
    empty: { alignItems: 'center', gap: 12, paddingVertical: 32 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badge: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    times: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
    time: { fontSize: 13, fontWeight: '600', color: colors.text },
  });
