import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { listTrailMaps, sessionStarts } from '../db';
import { areaAt, skiAreas, type SkiArea } from '../lib/areas';
import { mapFor, type TrailMap } from '../lib/trailmap';
import type { TrackPoint, Units } from '../lib/types';
import { fmtSnow, fmtTemp, fmtWind, weatherInfo, type Weather } from '../lib/weather';
import { downloadTrailMap } from '../mountain/pistes';
import { getWeather } from '../mountain/weather';
import { useStyles, useTheme, type Palette } from '../theme';
import { LiveMap } from './LiveMap';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Snow and weather where you are, plus the offline trail map: download it
 * before you head up, then open the live map on the mountain without signal.
 */
export function MountainCard({ points, units }: { points: TrackPoint[]; units: Units }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const [known, setKnown] = useState<{ lat: number; lon: number; alt: number | null } | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [trail, setTrail] = useState<TrailMap | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [area, setArea] = useState<SkiArea | null>(null);
  const first = points[0];

  // The area: where today's recording started, else the phone's last known position.
  const pos = useMemo(
    () => (first ? { lat: first.lat, lon: first.lon, alt: first.alt } : known),
    [first, known],
  );

  const locate = useCallback(async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      setNeedsPermission(true);
      return;
    }
    setNeedsPermission(false);
    const l = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({}));
    if (l) setKnown({ lat: l.coords.latitude, lon: l.coords.longitude, alt: l.coords.altitude });
  }, []);

  useEffect(() => {
    if (first) return;
    // Don't prompt on open; just use the position if access was already given.
    Location.getForegroundPermissionsAsync()
      .then(async (perm) => {
        if (perm.status !== 'granted') {
          setNeedsPermission(true);
          return;
        }
        const l = await Location.getLastKnownPositionAsync();
        if (l) setKnown({ lat: l.coords.latitude, lon: l.coords.longitude, alt: l.coords.altitude });
      })
      .catch(() => undefined);
  }, [first]);

  useEffect(() => {
    if (!pos) return;
    getWeather(pos.lat, pos.lon, pos.alt).then(setWeather);
    listTrailMaps().then((maps) => setTrail(mapFor(maps, pos)));
    sessionStarts()
      .then((starts) => setArea(areaAt(skiAreas(starts.filter((x) => !x.isDemo)), pos)))
      .catch(() => undefined);
  }, [pos]);

  const download = async () => {
    if (!pos) return;
    setDownloading(true);
    try {
      const m = await downloadTrailMap(pos.lat, pos.lon);
      if (m) {
        setTrail(m);
        Alert.alert('Trail map saved', `${m.pistes.length} pistes and ${m.lifts.length} lifts around you are now on your phone, also without signal.`);
      } else {
        Alert.alert('Couldn’t download', 'No connection to the map server. Try again with signal or Wi-Fi.');
      }
    } finally {
      setDownloading(false);
    }
  };

  if (needsPermission) {
    return (
      <Pressable style={[s.card, styles.row]} onPress={() => locate().catch(() => undefined)}>
        <Ionicons name="snow-outline" size={20} color={colors.accent} />
        <Text style={[s.body, { flex: 1 }]}>Allow location to see snow, weather and the trail map here.</Text>
      </Pressable>
    );
  }
  if (!pos) return null;

  const w = weather;
  const now = w ? weatherInfo(w.code) : null;

  return (
    <View style={[s.card, { gap: 10 }]}>
      {area ? (
        <Text style={[s.body, { fontWeight: '700' }]}>
          📍 {points.length ? area.name : `You’re at ${area.name}`}
          <Text style={s.muted}>  {area.days} {area.days === 1 ? 'day' : 'days'} here before</Text>
        </Text>
      ) : null}
      {w ? (
        <>
          <View style={styles.row}>
            <Text style={{ fontSize: 34 }}>{now!.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.temp}>
                {fmtTemp(w.tempC, units)} <Text style={s.muted}>feels {fmtTemp(w.feelsC, units)}</Text>
              </Text>
              <Text style={s.muted}>
                {now!.label} · wind {fmtWind(w.windKmh, units)}{w.gustKmh ? `, gusts ${fmtWind(w.gustKmh, units)}` : ''}
              </Text>
            </View>
          </View>
          <View style={styles.snowRow}>
            <View style={styles.snowCell}>
              <Text style={s.label}>Fresh snow 24 h</Text>
              <Text style={styles.snowVal}>{fmtSnow(w.freshSnowCm, units)}</Text>
            </View>
            <View style={styles.snowCell}>
              <Text style={s.label}>Snow depth</Text>
              <Text style={styles.snowVal}>{fmtSnow(w.snowDepthCm, units)}</Text>
            </View>
          </View>
          <View style={styles.days}>
            {w.days.slice(0, 3).map((d) => (
              <View key={d.date} style={styles.day}>
                <Text style={s.muted}>{DAY_NAMES[new Date(`${d.date}T12:00:00`).getDay()]}</Text>
                <Text style={{ fontSize: 22 }}>{weatherInfo(d.code).emoji}</Text>
                <Text style={[s.body, { fontWeight: '700' }]}>{fmtTemp(d.maxC, units)} / {fmtTemp(d.minC, units)}</Text>
                {d.snowCm > 0 ? <Text style={[s.muted, { color: colors.accent }]}>❄ {fmtSnow(d.snowCm, units)}</Text> : null}
              </View>
            ))}
          </View>
        </>
      ) : (
        <Text style={s.muted}>Weather loads when you have signal.</Text>
      )}

      <View style={styles.mapRow}>
        {trail ? (
          <Pressable style={styles.btn} onPress={() => setShowMap(!showMap)}>
            <Ionicons name="map" size={18} color={colors.accent} />
            <Text style={styles.btnText}>{showMap ? 'Hide map' : 'Show trail map'}</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.btn} onPress={download} disabled={downloading}>
            {downloading ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="cloud-download-outline" size={18} color={colors.accent} />}
            <Text style={styles.btnText}>Download trail map (offline)</Text>
          </Pressable>
        )}
      </View>
      {trail ? (
        <Text style={[s.muted, { fontSize: 12 }]}>
          Offline map: {trail.pistes.length} pistes, {trail.lifts.length} lifts · saved {new Date(trail.fetchedAt).toLocaleDateString()}
          {'  '}
          <Text style={{ color: colors.accent, fontWeight: '700' }} onPress={download}>Update</Text>
        </Text>
      ) : null}
      {showMap && trail ? <LiveMap points={points} trail={trail} center={pos} /> : null}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    temp: { fontSize: 22, fontWeight: '900', color: colors.text },
    snowRow: { flexDirection: 'row', gap: 10 },
    snowCell: { flex: 1, backgroundColor: colors.accentSoft, borderRadius: 12, padding: 10 },
    snowVal: { fontSize: 20, fontWeight: '900', color: colors.text },
    days: { flexDirection: 'row', justifyContent: 'space-between' },
    day: { alignItems: 'center', flex: 1, gap: 2 },
    mapRow: { flexDirection: 'row', gap: 10 },
    btn: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent },
    btnText: { color: colors.accent, fontWeight: '800' },
  });
