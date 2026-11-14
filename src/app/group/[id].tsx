import { Tap } from '../../components/Tap';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Stack from 'expo-router/stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { dialog } from '../../dialog';
import { APP_DOWNLOAD_URL } from '../../config';
import { listSegments } from '../../db';
import { api } from '../../friends/api';
import { syncFriends } from '../../friends/sync';
import { fmtAlt, fmtDelta, fmtDist, fmtDuration, fmtRaceTime, fmtSpeed } from '../../lib/format';
import {
  dateToMs, localDate, rankBoard, rankChallenge, type BoardMetric, type BoardRow, type ChallengeRow, type GroupChallenge, type GroupDetail,
} from '../../lib/groups';
import type { Segment } from '../../lib/segments';
import { useSettings } from '../../settings';
import { Avatar } from '../../components/Avatar';
import { useStyles, useTheme, type Palette } from '../../theme';

const METRICS: { key: BoardMetric; label: string }[] = [
  { key: 'vertical', label: 'Vertical' },
  { key: 'topSpeed', label: 'Top speed' },
  { key: 'runs', label: 'Runs' },
];

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const ms = dateToMs(date);
  if (localDate(ms + 36 * 3600000) === today) return 'Yesterday';
  if (localDate(ms - 12 * 3600000) === today) return 'Tomorrow';
  return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** A friend group: who skied most on a day, and the group's challenges with automatic rankings. */
export default function GroupScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { units, playerId, serverUrl, serverPassword } = useSettings();
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [metric, setMetric] = useState<BoardMetric>('vertical');
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [boards, setBoards] = useState<Record<string, ChallengeRow[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setToday(localDate(Date.now()));
      setDetail(await api.group(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      // Share your newest days first, so you're on the board too.
      syncFriends().catch(() => undefined).finally(() => { load(); });
    }, [load]),
  );

  const dates = detail ? [...new Set([today, ...detail.dates, ...detail.challenges.map((c) => c.date)])].sort().reverse() : [];
  const shown = date ?? (detail?.dates.includes(today) || !detail?.dates.length ? today : detail.dates[0]);

  useEffect(() => {
    if (!id || !shown || !detail) return;
    let live = true;
    api.board(id, shown)
      .then((r) => { if (live) setBoard(r.rows); })
      .catch(() => { if (live) setBoard(null); });
    // Rankings of the challenges set for that day.
    for (const c of detail.challenges.filter((x) => x.date === shown)) {
      api.challengeBoard(id, c.id)
        .then((r) => { if (live) setBoards((cur) => ({ ...cur, [c.id]: r.rows })); })
        .catch(() => undefined);
    }
    return () => { live = false; };
  }, [id, shown, detail]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await syncFriends().catch(() => undefined);
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (error && !detail) {
    return (
      <View style={[s.screen, styles.content]}>
        <Text style={[s.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        <Pressable onPress={load}><Text style={[styles.link, { textAlign: 'center' }]}>Try again</Text></Pressable>
      </View>
    );
  }
  if (!detail) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  const invite = () =>
    Share.share({
      message: [
        `Join my ski group “${detail.name}” in Ski Tracker!`,
        '',
        `1. Get the app: ${APP_DOWNLOAD_URL}`,
        '2. Copy this whole message, open the app and tap “Paste invite”. Or type:',
        `   Server: ${serverUrl}`,
        ...(serverPassword ? [`   Password: ${serverPassword}`] : []),
        `   Group code: ${detail.code}`,
      ].join('\n'),
    });

  const leave = () =>
    dialog(`Leave “${detail.name}”?`, 'Your days stay on your phone. You can join again with the code.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.leaveGroup(detail.id);
            await syncFriends().catch(() => undefined);
            router.back();
          } catch (e) {
            dialog('Couldn’t leave', e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);

  const ranked = board ? rankBoard(board, metric) : null;
  const avatarOf = new Map(detail.members.map((m) => [m.playerId, !!m.hasAvatar]));
  const fmtMetric = (r: BoardRow) =>
    metric === 'vertical' ? fmtAlt(r.vertical, units) : metric === 'topSpeed' ? fmtSpeed(r.topSpeed, units) : `${r.runs} ${r.runs === 1 ? 'run' : 'runs'}`;
  const dayChallenges = detail.challenges.filter((c) => c.date === shown);
  const otherChallenges = detail.challenges.filter((c) => c.date !== shown);

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
    >
      <Stack.Screen
        options={{
          title: detail.name,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable onPress={invite} hitSlop={10} accessibilityLabel="Invite friends">
                <Ionicons name="person-add-outline" size={22} color={colors.accent} />
              </Pressable>
              <Pressable onPress={leave} hitSlop={10} accessibilityLabel="Leave group">
                <Ionicons name="exit-outline" size={22} color={colors.danger} />
              </Pressable>
            </View>
          ),
        }}
      />

      <Pressable onPress={invite} style={[s.card, styles.codeCard]}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Invite code</Text>
          <Text style={styles.code}>{detail.code}</Text>
        </View>
        <Text style={s.muted}>{detail.members.length} {detail.members.length === 1 ? 'skier' : 'skiers'}</Text>
        <Ionicons name="share-social-outline" size={22} color={colors.accent} />
      </Pressable>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {dates.map((d) => (
          <Pressable key={d} onPress={() => setDate(d)} style={[styles.pill, d === shown && styles.pillOn]}>
            <Text style={[styles.pillText, d === shown && { color: colors.onAccent }]}>{dayLabel(d, today)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[s.card, { gap: 12 }]}>
        <View style={styles.segment}>
          {METRICS.map((m) => (
            <Pressable key={m.key} onPress={() => setMetric(m.key)} style={[styles.segBtn, metric === m.key && styles.segOn]}>
              <Text style={[styles.segText, metric === m.key && { color: colors.onAccent }]}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        {!ranked ? (
          <ActivityIndicator color={colors.accent} />
        ) : ranked.every((r) => r.rank == null) ? (
          <Text style={[s.muted, { textAlign: 'center', paddingVertical: 8 }]}>
            Nobody has a finished day on {dayLabel(shown, today).toLowerCase()} yet. Days show up here when you finish them.
          </Text>
        ) : (
          ranked.map((r) => (
            <Pressable
              key={r.playerId}
              onPress={() => router.push(`/player/${r.playerId}`)}
              style={[styles.rankRow, r.playerId === playerId && styles.meRow, r.rank == null && { opacity: 0.45 }]}
              accessibilityLabel={`${r.name}’s profile`}
            >
              <Text style={styles.rank}>{r.rank ?? '–'}</Text>
              <Avatar playerId={r.playerId} name={r.name} size={34} hasAvatar={!!avatarOf.get(r.playerId)} />
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontWeight: '700' }]} numberOfLines={1}>{r.playerId === playerId ? `${r.name} (you)` : r.name}</Text>
                {r.rank != null ? (
                  <Text style={s.muted} numberOfLines={1}>
                    {[
                      metric !== 'vertical' ? fmtAlt(r.vertical, units) : null,
                      metric !== 'topSpeed' ? fmtSpeed(r.topSpeed, units) : null,
                      metric !== 'runs' ? `${r.runs} runs` : null,
                      fmtDist(r.distance, units),
                      fmtDuration(r.skiTime),
                    ].filter(Boolean).join(' · ')}
                  </Text>
                ) : (
                  <Text style={s.muted}>Didn’t ski</Text>
                )}
              </View>
              {r.rank != null ? <Text style={styles.value}>{fmtMetric(r)}</Text> : null}
            </Pressable>
          ))
        )}
      </View>

      <View style={styles.sectionHead}>
        <Text style={s.h2}>Group challenges</Text>
        <Pressable onPress={() => setPicking(!picking)} hitSlop={8}>
          <Text style={styles.link}>{picking ? 'Cancel' : '+ New'}</Text>
        </Pressable>
      </View>
      {picking ? (
        <NewChallenge
          groupId={detail.id}
          today={today}
          onDone={async (c) => {
            setPicking(false);
            setDate(c.date);
            await syncFriends().catch(() => undefined);
            await load();
          }}
        />
      ) : null}
      {!detail.challenges.length && !picking ? (
        <Text style={s.muted}>
          Set a challenge: everyone who skis it that day is timed.
        </Text>
      ) : null}
      {dayChallenges.map((c) => (
        <ChallengeCard key={c.id} c={c} rows={boards[c.id]} groupId={detail.id} ownerId={detail.createdBy} today={today} onRemoved={load} />
      ))}
      {otherChallenges.length ? <Text style={[s.label, { marginTop: 4 }]}>Other days</Text> : null}
      {otherChallenges.map((c) => (
        <ChallengeCard key={c.id} c={c} rows={boards[c.id]} groupId={detail.id} ownerId={detail.createdBy} today={today} onRemoved={load} compact
          onOpen={() => setDate(c.date)} />
      ))}
    </ScrollView>
  );
}

function ChallengeCard({ c, rows, groupId, ownerId, today, onRemoved, compact, onOpen }: {
  c: GroupChallenge; rows?: ChallengeRow[]; groupId: string; ownerId: string; today: string; onRemoved: () => void;
  compact?: boolean; onOpen?: () => void;
}) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { playerId } = useSettings();
  const ranked = rows ? rankChallenge(rows) : null;
  const canRemove = c.createdBy === playerId || ownerId === playerId;

  const remove = () =>
    dialog(`Remove “${c.segment.name}”?`, 'It stops being a group challenge. Times already set stay on everyone’s phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => api.removeChallenge(groupId, c.id).then(onRemoved).catch((e) => dialog('Couldn’t remove', String(e?.message ?? e))),
      },
    ]);

  return (
    <Pressable onPress={compact ? onOpen : () => router.push(`/segment/${c.segmentId}`)} onLongPress={canRemove ? remove : undefined} style={[s.card, { gap: 8 }]}>
      <View style={styles.sectionHead}>
        <Ionicons name="flag-outline" size={20} color={colors.accent} />
        <View style={{ flex: 1 }}>
          <Text style={s.h2} numberOfLines={1}>{c.segment.name}</Text>
          <Text style={s.muted}>{dayLabel(c.date, today)} · set by {c.createdBy === playerId ? 'you' : c.createdByName}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </View>
      {compact ? null : !ranked ? (
        <ActivityIndicator color={colors.accent} />
      ) : !ranked.length ? (
        <Text style={s.muted}>
          {c.date >= today ? 'No times yet. Ski it on the day: you’re timed automatically.' : 'Nobody skied it that day.'}
        </Text>
      ) : (
        ranked.map((r) => (
          <View key={r.playerId} style={[styles.rankRow, r.playerId === playerId && styles.meRow]}>
            <Text style={styles.rank}>{r.rank}</Text>
            <Text style={[s.body, { flex: 1, fontWeight: '600' }]} numberOfLines={1}>{r.playerId === playerId ? 'You' : r.playerName}</Text>
            {r.rank > 1 ? <Text style={[s.muted, { color: colors.danger }]}>{fmtDelta(r.time - ranked[0].time)}</Text> : null}
            <Text style={styles.value}>{fmtRaceTime(r.time)}</Text>
          </View>
        ))
      )}
      {canRemove && !compact ? <Text style={[s.muted, { fontSize: 11 }]}>Press and hold to remove.</Text> : null}
    </Pressable>
  );
}

/** Pick one of your challenges and a day to make it the group's challenge. */
function NewChallenge({ groupId, today, onDone }: { groupId: string; today: string; onDone: (c: GroupChallenge) => void }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units } = useSettings();
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    listSegments().then(setSegments).catch(() => setSegments([]));
  }, []);

  const days = Array.from({ length: 8 }, (_, k) => localDate(dateToMs(today) + (k * 24 + 12) * 3600000));

  const pick = async (seg: Segment) => {
    setBusy(seg.id);
    try {
      onDone(await api.addChallenge(groupId, day, seg));
    } catch (e) {
      dialog('Couldn’t set the challenge', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[s.card, { gap: 12 }]}>
      <Text style={s.label}>Which day?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((d) => (
          <Pressable key={d} onPress={() => setDay(d)} style={[styles.pill, d === day && styles.pillOn]}>
            <Text style={[styles.pillText, d === day && { color: colors.onAccent }]}>{dayLabel(d, today)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={s.label}>Which stretch?</Text>
      {!segments ? (
        <ActivityIndicator color={colors.accent} />
      ) : !segments.length ? (
        <Text style={s.muted}>
          No challenges yet. Tap the flag on a run in Days to make one.
        </Text>
      ) : (
        segments.map((seg) => (
          <Tap key={seg.id} onPress={() => pick(seg)} disabled={!!busy} style={styles.rankRow}>
            <Ionicons name="flag-outline" size={18} color={colors.accent} />
            <Text style={[s.body, { flex: 1, fontWeight: '600' }]} numberOfLines={1}>{seg.name}</Text>
            {busy === seg.id ? <ActivityIndicator color={colors.accent} /> : <Text style={s.muted}>{fmtDist(segLength(seg), units)}</Text>}
          </Tap>
        ))
      )}
    </View>
  );
}

function segLength(seg: Segment): number {
  let d = 0;
  for (let i = 1; i < seg.path.length; i++) {
    const [a, b] = [seg.path[i - 1], seg.path[i]];
    const x = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180) * 111320, y = (b[0] - a[0]) * 110540;
    d += Math.hypot(x, y);
  }
  return d;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    codeCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    code: { fontSize: 24, fontWeight: '700', letterSpacing: 4, color: colors.text },
    pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.faint },
    pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    pillText: { fontWeight: '600', color: colors.text },
    segment: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 12, padding: 4 },
    segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
    segOn: { backgroundColor: colors.accent },
    segText: { fontWeight: '600', color: colors.text },
    rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 },
    meRow: { backgroundColor: colors.accentSoft },
    rank: { width: 30, fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
    value: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
    link: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  });
