import { Tap } from '../components/Tap';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { importChallenge } from '../challenges/service';
import { SegmentMap } from '../components/SegmentMap';
import { getSegment } from '../db';
import { fmtAlt, fmtDist, fmtRaceTime } from '../lib/format';
import { leaderboard, pathInfo } from '../lib/segments';
import { decodeChallenge, type ChallengePayload } from '../lib/share';
import { useSettings } from '../settings';
import { useTheme, useStyles, type Palette } from '../theme';
import { refreshRacers } from '../tracking/tracker';

/**
 * Opened from an invite link (skiapp://c?d=…) or "Paste invite".
 * Shows who's challenging you and lets you accept.
 */
export default function InviteScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { d } = useLocalSearchParams<{ d?: string }>();
  const { units, playerId } = useSettings();
  const [have, setHave] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo((): { ok: ChallengePayload } | { error: string } => {
    try {
      if (!d) throw new Error('This invite link is empty.');
      return { ok: decodeChallenge(String(d)) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'This invite link is broken.' };
    }
  }, [d]);

  useEffect(() => {
    if ('ok' in parsed) getSegment(parsed.ok.segment.id).then((x) => setHave(!!x));
  }, [parsed]);

  if ('error' in parsed) {
    return (
      <View style={[s.screen, styles.center]}>
        <Ionicons name="alert-circle-outline" size={44} color={colors.danger} />
        <Text style={[s.h2, { textAlign: 'center' }]}>{parsed.error}</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>Ask your friend to send the invite again.</Text>
        <Pressable onPress={() => router.replace('/challenges')} style={styles.secondary}>
          <Text style={styles.secondaryText}>Go to Challenges</Text>
        </Pressable>
      </View>
    );
  }

  const { segment, attempts, fromName } = parsed.ok;
  const info = pathInfo(segment.path);
  const board = leaderboard(attempts);
  const leader = board[0];
  const fromMe = attempts.length > 0 && attempts.every((a) => a.playerId === playerId);

  const accept = async () => {
    setSaving(true);
    try {
      const res = await importChallenge(parsed.ok);
      await refreshRacers();
      router.replace(`/segment/${res.segmentId}`);
    } catch {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <View style={[s.card, styles.hero]}>
        <Ionicons name="flag-outline" size={40} color={colors.accent} />
        <Text style={[s.h1, { textAlign: 'center' }]}>
          {have ? `New times on “${segment.name}”` : `${fromName ?? 'A friend'} challenges you!`}
        </Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>
          {have
            ? `Latest times from ${fromName ?? 'your friend'}.`
            : `Ski “${segment.name}” faster than ${leader ? fmtRaceTime(leader.time) : 'them'}.`}
        </Text>
      </View>

      <SegmentMap path={segment.path} gateRadius={segment.gateRadius} />
      <Text style={s.muted}>
        {segment.name} · {fmtDist(info.length, units)}{info.drop != null ? ` · ↓ ${fmtAlt(info.drop, units)}` : ''}
      </Text>

      {board.length ? (
        <View style={[s.card, { gap: 8 }]}>
          <Text style={s.label}>Leaderboard</Text>
          {board.map((e) => (
            <View key={e.playerId} style={styles.lbRow}>
              <Text style={s.body}>#{e.rank} {e.playerName}{e.playerId === playerId ? ' (you)' : ''}</Text>
              <Text style={[s.body, { fontWeight: '700' }]}>{fmtRaceTime(e.time)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {fromMe ? <Text style={[s.muted, { textAlign: 'center' }]}>Your own invite.</Text> : null}

      <Tap onPress={accept} disabled={saving || have === null} style={styles.accept}>
        {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.acceptText}>{have ? 'Update leaderboard' : 'Accept challenge'}</Text>}
      </Tap>
      <Text style={[s.muted, { textAlign: 'center' }]}>
        Record a day and ski it: timing is automatic.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
    hero: { alignItems: 'center', gap: 8, paddingVertical: 20 },
    lbRow: { flexDirection: 'row', justifyContent: 'space-between' },
    accept: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    acceptText: { color: colors.onAccent, fontSize: 17, fontWeight: '700' },
    secondary: { borderWidth: 1, borderColor: colors.accent, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
    secondaryText: { color: colors.accent, fontWeight: '600' },
  });
