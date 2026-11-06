import { useLocalSearchParams } from 'expo-router';
import Stack from 'expo-router/stack';
import { useEffect, useState } from 'react';
import { BadgeSheet, type BadgeView } from '../../components/BadgeSheet';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { StatGrid, StatTile } from '../../components/StatTile';
import { api, type PlayerProfile } from '../../friends/api';
import { fmtAlt, fmtDate, fmtDist, fmtDuration, fmtSpeed } from '../../lib/format';
import { dateToMs } from '../../lib/groups';
import { useSettings } from '../../settings';
import { useStyles, useTheme, type Palette } from '../../theme';

/** A skier's profile, as their friends see it: picture, season totals, recent days and badges. */
export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units, playerId } = useSettings();
  const [p, setP] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openBadge, setOpenBadge] = useState<BadgeView | null>(null);

  useEffect(() => {
    if (!id) return;
    api.player(id).then(setP).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <Text style={[s.body, { padding: 24, color: colors.danger, textAlign: 'center' }]}>{error}</Text>;
  if (!p) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  const t = p.season;
  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: p.id === playerId ? 'My profile' : p.name }} />
      <View style={[s.card, styles.hero]}>
        <Avatar playerId={p.id} name={p.name} size={96} hasAvatar={p.hasAvatar} />
        <Text style={s.h1}>{p.name}</Text>
        {p.username ? <Text style={s.muted}>@{p.username}</Text> : null}
      </View>

      <Text style={s.h2}>Season {t.key}</Text>
      {t.days ? (
        <StatGrid>
          <StatTile label="Ski days" value={String(t.days)} />
          <StatTile label="Vertical" value={fmtAlt(t.vertical, units)} />
          <StatTile label="Top speed" value={fmtSpeed(t.topSpeed, units)} />
          <StatTile label="Runs" value={String(t.runs)} />
          <StatTile label="Distance skied" value={fmtDist(t.distance, units)} />
          <StatTile label="Time skiing" value={fmtDuration(t.skiTime)} />
        </StatGrid>
      ) : (
        <Text style={s.muted}>No ski days this season yet.</Text>
      )}

      {p.allTime.days > t.days ? (
        <View style={[s.card, { gap: 4 }]}>
          <Text style={s.label}>All time</Text>
          <Text style={s.body}>
            {p.allTime.days} days · {fmtAlt(p.allTime.vertical, units)} · top {fmtSpeed(p.allTime.topSpeed, units)}
          </Text>
        </View>
      ) : null}

      {p.recent.length ? (
        <View style={[s.card, { gap: 6 }]}>
          <Text style={s.label}>Recent days</Text>
          {p.recent.map((d) => (
            <View key={d.date} style={styles.dayRow}>
              <Text style={[s.body, { flex: 1 }]}>{fmtDate(dateToMs(d.date))}</Text>
              <Text style={s.muted}>{fmtAlt(d.vertical, units)} · {fmtSpeed(d.topSpeed, units)} · {d.runs} runs</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={s.h2}>Badges</Text>
      {p.badges.length ? (
        <View style={styles.badges}>
          {p.badges.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => setOpenBadge({ id: b.id, emoji: b.emoji, title: b.title, earnedAt: b.at })}
              style={({ pressed }) => [s.card, styles.badge, pressed && { transform: [{ scale: 0.96 }] }]}
              accessibilityRole="button"
              accessibilityLabel={`${b.title}. Tap for details.`}
            >
              <Text style={{ fontSize: 28 }}>{b.emoji}</Text>
              <Text style={styles.badgeTitle} numberOfLines={1}>{b.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={s.muted}>No badges yet.</Text>
      )}
      <BadgeSheet badge={openBadge} onClose={() => setOpenBadge(null)} whose={p.id === playerId ? 'you' : p.name} />
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    hero: { alignItems: 'center', gap: 6, paddingVertical: 20 },
    dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    badge: { width: '31%', alignItems: 'center', gap: 2, paddingVertical: 12, paddingHorizontal: 6 },
    badgeTitle: { fontSize: 12, fontWeight: '800', color: colors.text, textAlign: 'center' },
  });
