import { Tap } from '../components/Tap';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { api } from '../friends/api';
import { cachedGroups, syncFriends } from '../friends/sync';
import { fmtAlt, fmtDist, fmtDuration, fmtSpeed } from '../lib/format';
import { CATEGORIES, crowns, rank, type FriendTotals, type StatKind } from '../lib/leaderboard';
import type { Units } from '../lib/types';
import { useSettings } from '../settings';
import { font, radius, size, space, useStyles, useTheme, type Palette } from '../theme';

type Period = 'season' | 'allTime';
type Loaded = { season: FriendTotals[]; allTime: FriendTotals[]; seasonKey: string };

const SHOWN = 5;

function fmt(kind: StatKind, v: number, units: Units): string {
  switch (kind) {
    case 'alt': return fmtAlt(v, units);
    case 'speed': return fmtSpeed(v, units);
    case 'dist': return fmtDist(v, units);
    case 'hours': return fmtDuration(v);
    case 'everest': return `${v.toFixed(2)}×`;
    case 'count': return String(Math.round(v));
  }
}

/** Everyone in your groups (and you), ranked on fun season stats. */
async function loadFriends(me: string): Promise<Loaded> {
  await syncFriends().catch(() => undefined);
  const groups = await cachedGroups();
  const ids = new Set([me]);
  // ponytail: one request per group and per friend; add a server "friends totals" endpoint if groups get big.
  for (const g of await Promise.all(groups.map((x) => api.group(x.id).catch(() => null)))) {
    for (const m of g?.members ?? []) ids.add(m.playerId);
  }
  const profiles = (await Promise.all([...ids].map((id) => api.player(id).catch(() => null)))).filter((p) => p != null);
  return {
    seasonKey: profiles[0]?.season.key ?? '',
    season: profiles.map((p) => ({ id: p.id, name: p.name, hasAvatar: p.hasAvatar, totals: p.season })),
    allTime: profiles.map((p) => ({ id: p.id, name: p.name, hasAvatar: p.hasAvatar, totals: p.allTime })),
  };
}

export default function BoardsScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units, playerId, serverUrl } = useSettings();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('season');
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!serverUrl) return Promise.resolve();
    return loadFriends(playerId)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [serverUrl, playerId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const friends = useMemo(() => (data ? data[period] : []), [data, period]);
  const myCrowns = useMemo(() => crowns(friends, playerId), [friends, playerId]);

  if (!serverUrl) return <View style={[s.screen, styles.aside]}><Text style={[s.muted, { textAlign: 'center' }]}>Set up a friends server under You first.</Text></View>;
  if (!data && error) return <View style={[s.screen, styles.aside]}><Text style={[s.body, { padding: space.xl, color: colors.danger, textAlign: 'center' }]}>{error}</Text></View>;
  if (!data) return <View style={[s.screen, styles.aside]}><ActivityIndicator style={{ marginTop: space.xxxl }} color={colors.accent} /></View>;

  const refresh = () => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  };

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
    >
            <View style={styles.pills}>
        {(['season', 'allTime'] as const).map((p) => (
          <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.pill, p === period && styles.pillOn]}>
            <Text style={[styles.pillText, p === period && { color: colors.onAccent }]}>
              {p === 'season' ? `Season ${data.seasonKey}` : 'All time'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={[s.card, styles.hero]}>
        <Ionicons name={myCrowns ? 'trophy' : 'trophy-outline'} size={36} color={myCrowns ? colors.warn : colors.muted} />
        <Text style={s.h2}>
          {myCrowns ? `You lead ${myCrowns} of ${CATEGORIES.length} boards` : 'No boards led yet'}
        </Text>
        <Text style={s.muted}>
          {friends.length > 1 ? `${friends.length} skiers` : 'Invite friends to a group'}
        </Text>
      </View>

      {CATEGORIES.map((cat) => {
        const rows = rank(friends, cat);
        const expanded = open === cat.id;
        const mine = rows.find((r) => r.friend.id === playerId);
        const shown = expanded ? rows : rows.slice(0, SHOWN);
        return (
          <View key={cat.id} style={[s.card, { gap: space.sm }]}>
            <View style={styles.catHead}>
              <Ionicons name={cat.icon} size={24} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={s.h2}>{cat.title}</Text>
                <Text style={s.muted}>{cat.blurb}</Text>
              </View>
            </View>
            {rows.length ? shown.map((r) => {
              const isMe = r.friend.id === playerId;
              return (
                <Tap
                  key={r.friend.id}
                  onPress={() => router.push(`/player/${r.friend.id}`)}
                  style={[styles.row, isMe && styles.rowMe]}
                  accessibilityLabel={`${r.rank}. ${r.friend.name}, ${fmt(cat.kind, r.value, units)}`}
                >
                  <Text style={styles.rank}>{r.rank}</Text>
                  <Avatar playerId={r.friend.id} name={r.friend.name} size={30} hasAvatar={r.friend.hasAvatar} />
                  <Text style={[s.body, { flex: 1, fontFamily: isMe ? font.medium : font.regular }]} numberOfLines={1}>
                    {isMe ? 'You' : r.friend.name}
                  </Text>
                  <Text style={styles.value}>{fmt(cat.kind, r.value, units)}</Text>
                </Tap>
              );
            }) : <Text style={s.muted}>Nobody yet.</Text>}
            {!expanded && mine && mine.rank > SHOWN ? (
              <Text style={s.muted}>You: #{mine.rank} · {fmt(cat.kind, mine.value, units)}</Text>
            ) : null}
            {rows.length > SHOWN ? (
              <Pressable onPress={() => setOpen(expanded ? null : cat.id)}>
                <Text style={styles.more}>{expanded ? 'Show less' : `Show all ${rows.length}`}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      {error ? <Text style={[s.muted, { color: colors.danger }]}>{error}</Text> : null}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
    aside: { padding: space.lg },
    pills: { flexDirection: 'row', gap: space.sm },
    pill: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.faint },
    pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    pillText: { fontFamily: font.medium, color: colors.text },
    hero: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl },
    catHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    // 12 = the redesign's radius.control for rows; switch to the token once it lands in theme.ts.
    row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: radius.control },
    rowMe: { backgroundColor: colors.warnSoft },
    rank: { width: 28, textAlign: 'center', fontSize: size.body, fontFamily: font.medium, color: colors.muted },
    value: { fontFamily: font.medium, color: colors.text, fontVariant: ['tabular-nums'] },
    more: { color: colors.accent, fontFamily: font.medium, textAlign: 'center', paddingVertical: space.xs },
  });
