import { Tap } from '../../components/Tap';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dialog } from '../../dialog';
import { captureRef } from 'react-native-view-shot';
import { DayShareCard } from '../../components/DayShareCard';
import { getPoints, getSession, type SessionRow } from '../../db';
import { cleanTrack, computeStats, smoothedSpeeds } from '../../lib/stats';
import type { TrackPoint } from '../../lib/types';
import { useSettings } from '../../settings';
import { useStyles, useTheme, type Palette } from '../../theme';

/** Preview of the day poster, with a button to share it as an image. */
export default function ShareDayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units } = useSettings();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [raw, setRaw] = useState<TrackPoint[] | null>(null);
  const [busy, setBusy] = useState(false);
  const card = useRef<ComponentRef<typeof View>>(null);

  useEffect(() => {
    getSession(id).then(setSession);
    getPoints(id).then(setRaw);
  }, [id]);

  const day = useMemo(() => {
    if (!raw) return null;
    const pts = cleanTrack(raw);
    return { pts, speeds: smoothedSpeeds(pts), stats: computeStats(raw) };
  }, [raw]);

  const share = async () => {
    setBusy(true);
    try {
      // 3× the on-screen size: 1080 × 1350, crisp on any feed.
      const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile', width: 1080, height: 1350 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your ski day' });
    } catch (e) {
      dialog('Couldn’t create the image', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!session || !day) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <DayShareCard
        ref={card}
        points={day.pts}
        speeds={day.speeds}
        stats={day.stats}
        place={session.place}
        startedAt={session.startedAt}
        units={units}
      />
      <Tap onPress={share} disabled={busy} style={styles.button}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : (
          <>
            <Ionicons name="share-social" size={22} color={colors.onAccent} />
            <Text style={styles.buttonText}>Share image</Text>
          </>
        )}
      </Tap>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 16, alignItems: 'center', paddingBottom: 40 },
    button: { alignSelf: 'stretch', flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16 },
    buttonText: { color: colors.onAccent, fontSize: 17, fontWeight: '700' },
  });
