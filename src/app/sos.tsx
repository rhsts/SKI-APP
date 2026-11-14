import { Tap } from '../components/Tap';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { dialog } from '../dialog';
import { listTrailMaps } from '../db';
import { emergencyNumbers, formatCoords } from '../lib/emergency';
import { mapFor, nearestFeature } from '../lib/trailmap';
import { fmtAlt, fmtTimeOfDay } from '../lib/format';
import { useSettings } from '../settings';
import { useStyles, useTheme, type Palette } from '../theme';
import { useTracker } from '../tracking/tracker';

/**
 * Everything you need if someone gets hurt: your exact position in the formats
 * rescue services ask for, one-tap calling and sharing your location.
 */
export default function SosScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { units } = useSettings();
  const t = useTracker();
  const last = t.points[t.points.length - 1];
  const [fix, setFix] = useState<{ lat: number; lon: number; alt: number | null; acc: number | null; at: number } | null>(
    last ? { lat: last.lat, lon: last.lon, alt: last.alt, acc: last.acc, at: last.t } : null,
  );
  const [locating, setLocating] = useState(true);
  const [near, setNear] = useState<ReturnType<typeof nearestFeature>>(null);
  const numbers = emergencyNumbers(Intl.DateTimeFormat().resolvedOptions().locale ?? 'en');

  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
        setFix({ lat: l.coords.latitude, lon: l.coords.longitude, alt: l.coords.altitude, acc: l.coords.accuracy, at: l.timestamp });
      } catch {
        // Keep the last recorded position.
      } finally {
        setLocating(false);
      }
    })();
  }, []);

  // Nearest named piste or lift from the offline trail map: rescuers always ask.
  useEffect(() => {
    if (!fix) return;
    listTrailMaps()
      .then((maps) => {
        const m = mapFor(maps, fix);
        setNear(m ? nearestFeature(m, fix) : null);
      })
      .catch(() => undefined);
  }, [fix]);

  const c = fix ? formatCoords(fix.lat, fix.lon) : null;
  const call = (n: string) => Linking.openURL(`tel:${n}`).catch(() => dialog('Can’t start a call', `Dial ${n} yourself.`));

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      {numbers.map((n, k) => (
        <Tap key={n} onPress={() => call(n)} style={[styles.call, k > 0 && styles.callAlt]}>
          <Ionicons name="call" size={k === 0 ? 28 : 20} color={k === 0 ? '#fff' : colors.danger} />
          <Text style={[styles.callText, k > 0 && { color: colors.danger, fontSize: 17 }]}>Call {n}</Text>
        </Tap>
      ))}
      <Text style={[s.muted, { textAlign: 'center' }]}>
        112 works across Europe and on most phones worldwide. On a piste, ski patrol can also be reached via the
        number on your lift pass or at any lift station.
      </Text>

      <View style={[s.card, { gap: 8 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={s.label}>Your position</Text>
          {locating ? <ActivityIndicator color={colors.accent} /> : null}
        </View>
        {c && fix ? (
          <>
            <Text selectable style={styles.coords}>{c.decimal}</Text>
            <Text selectable style={[s.body, { fontVariant: ['tabular-nums'] }]}>{c.dms}</Text>
            {near ? (
              <Text style={[s.body, { fontWeight: '600' }]}>
                {near.meters < 30 ? 'On' : `${near.meters} m from`} {near.kind === 'lift' ? 'lift' : 'piste'} “{near.name}”
              </Text>
            ) : null}
            <Text style={s.muted}>
              Altitude {fmtAlt(fix.alt, units)}
              {fix.acc != null ? ` · accurate to ±${Math.round(fix.acc)} m` : ''}
              {` · fix at ${fmtTimeOfDay(fix.at)}`}
            </Text>
            <View style={styles.row}>
              <Pressable
                style={styles.btn}
                onPress={async () => {
                  await Clipboard.setStringAsync(`${c.decimal} (${c.dms})`);
                  dialog('Copied', 'Coordinates copied. Paste them into a message.');
                }}
              >
                <Ionicons name="copy-outline" size={18} color={colors.accent} />
                <Text style={styles.btnText}>Copy</Text>
              </Pressable>
              <Pressable
                style={styles.btn}
                onPress={() => Share.share({ message: `I need help. My location: ${c.decimal}${near ? ` (near ${near.kind} “${near.name}”)` : ''}\n${c.mapsLink}` })}
              >
                <Ionicons name="share-outline" size={18} color={colors.accent} />
                <Text style={styles.btnText}>Send location</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Text style={s.body}>{locating ? 'Finding your position…' : 'No position yet. Allow location access and step into the open.'}</Text>
        )}
      </View>

      <View style={[s.card, { gap: 8 }]}>
        <Text style={s.label}>What to tell them</Text>
        {[
          'What happened and how many people are hurt',
          'Your position (read out the numbers above)',
          'The piste name or nearest lift, if you know it',
          'Your phone number. Stay on the line, keep the injured person warm',
          'Mark the spot: cross skis upright in the snow above the injured person',
        ].map((line) => (
          <Text key={line} style={s.body}>• {line}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 40 },
    call: { flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger, borderRadius: 16, minHeight: 76 },
    callAlt: { backgroundColor: 'transparent', borderWidth: 2, borderColor: colors.danger, minHeight: 52 },
    callText: { color: '#fff', fontSize: 24, fontWeight: '700' },
    coords: { fontSize: 20, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
    row: { flexDirection: 'row', gap: 12, marginTop: 4 },
    btn: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.accent },
    btnText: { color: colors.accent, fontWeight: '700' },
  });
