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
import { space, target, useTheme } from '../theme';
import { LiveMap } from './LiveMap';
import { Row } from './Row';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (date: string) => DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];

export interface Mountain {
  pos: { lat: number; lon: number; alt: number | null } | null;
  /** The ski area you're at, if you have skied here before. */
  area: SkiArea | null;
  weather: Weather | null;
  /** The saved offline trail map that covers this spot. */
  trail: TrailMap | null;
  needsPermission: boolean;
  downloading: boolean;
  locate: () => Promise<void>;
  download: () => Promise<void>;
}

/**
 * Snow and weather where you are, plus the offline trail map: download it
 * before you head up, then open the live map on the mountain without signal.
 */
export function useMountain(points: TrackPoint[]): Mountain {
  const [known, setKnown] = useState<Mountain['pos']>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [trail, setTrail] = useState<TrailMap | null>(null);
  const [downloading, setDownloading] = useState(false);
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

  const download = useCallback(async () => {
    if (!pos) return;
    setDownloading(true);
    try {
      const map = await downloadTrailMap(pos.lat, pos.lon);
      if (map) {
        setTrail(map);
        Alert.alert('Trail map saved', `${map.pistes.length} pistes and ${map.lifts.length} lifts around you are now on your phone, also without signal.`);
      } else {
        Alert.alert('Couldn’t download', 'No connection to the map server. Try again with signal or Wi-Fi.');
      }
    } finally {
      setDownloading(false);
    }
  }, [pos]);

  return { pos, area, weather, trail, needsPermission: needsPermission && !first, downloading, locate, download };
}

/** "-6°C, clear. 14 cm fresh in 24 h." */
function conditions(w: Weather, units: Units): string {
  const sky = weatherInfo(w.code).label.toLowerCase();
  const fresh = w.freshSnowCm > 0 ? `${fmtSnow(w.freshSnowCm, units)} fresh in 24 h.` : 'No fresh snow.';
  return `${fmtTemp(w.tempC, units)}${sky === '–' ? '' : `, ${sky}`}. ${fresh}`;
}

/** "Feels -11°C · wind 12 km/h, gusts 30 km/h · base 142 cm" */
function detail(w: Weather, units: Units): string {
  return [
    `Feels ${fmtTemp(w.feelsC, units)}`,
    `wind ${fmtWind(w.windKmh, units)}${w.gustKmh ? `, gusts ${fmtWind(w.gustKmh, units)}` : ''}`,
    w.snowDepthCm != null ? `base ${fmtSnow(w.snowDepthCm, units)}` : null,
  ].filter(Boolean).join(' · ');
}

/** Where you are and what the snow is like, as one quiet heading and a line. Shown before you start. */
export function MountainIntro({ m, units }: { m: Mountain; units: Units }) {
  const { s } = useTheme();
  if (m.needsPermission) {
    return (
      <Pressable style={styles.intro} onPress={() => m.locate().catch(() => undefined)} accessibilityRole="button">
        <Text style={s.h1}>Ready</Text>
        <Text style={s.body}>Allow location to see snow, weather and the trail map here.</Text>
      </Pressable>
    );
  }
  const w = m.weather;
  return (
    <View style={styles.intro}>
      <Text style={s.h1}>{m.area?.name ?? 'Ready'}</Text>
      {w ? <Text style={[s.body, styles.figures]}>{conditions(w, units)}</Text> : m.pos ? <Text style={s.muted}>Weather loads when you have signal.</Text> : null}
      {w || m.area ? (
        <Text style={[s.muted, styles.figures]}>
          {[w ? detail(w, units) : null, m.area ? `${m.area.days} ${m.area.days === 1 ? 'day' : 'days'} here before` : null].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

/** Trail map and weather as two rows that open in place. `live`: you're recording. */
export function MountainRows({ m, points, units, live }: { m: Mountain; points: TrackPoint[]; units: Units; live?: boolean }) {
  const { colors, s } = useTheme();
  const [open, setOpen] = useState<'map' | 'weather' | null>(null);
  if (!m.pos) return null;
  const { trail, weather: w } = m;
  const snowDay = w?.days.slice(0, 3).find((d) => d.snowCm > 0);

  return (
    <>
      {trail ? (
        <Row label="Trail map" value="Saved for offline" onPress={() => setOpen(open === 'map' ? null : 'map')} open={open === 'map'}>
          <LiveMap points={points} trail={trail} center={m.pos} />
          <View style={styles.mapFoot}>
            <Text style={[s.muted, styles.grow]}>
              {trail.pistes.length} pistes, {trail.lifts.length} lifts · saved {new Date(trail.fetchedAt).toLocaleDateString()}
            </Text>
            <Pressable onPress={m.download} disabled={m.downloading} style={styles.link} accessibilityRole="button" accessibilityLabel="Update trail map">
              {m.downloading ? <ActivityIndicator color={colors.accent} /> : <Text style={[s.control, { color: colors.accent }]}>Update</Text>}
            </Pressable>
          </View>
        </Row>
      ) : (
        <Row
          label="Trail map"
          value={m.downloading ? 'Downloading' : 'Download for offline'}
          onPress={m.downloading ? undefined : m.download}
          trailing={m.downloading ? <ActivityIndicator color={colors.accent} /> : undefined}
        />
      )}
      {w ? (
        <Row
          label={live ? 'Weather' : 'Next three days'}
          value={live ? `${fmtTemp(w.tempC, units)}, ${weatherInfo(w.code).label.toLowerCase()}` : snowDay ? `Snow on ${dayName(snowDay.date)}` : 'No snow due'}
          onPress={() => setOpen(open === 'weather' ? null : 'weather')}
          open={open === 'weather'}
        >
          {live ? (
            <View>
              <Text style={[s.body, styles.figures]}>{conditions(w, units)}</Text>
              <Text style={[s.muted, styles.figures]}>{detail(w, units)}</Text>
            </View>
          ) : null}
          <View>
            {w.days.slice(0, 3).map((d) => (
              <View key={d.date} style={styles.day}>
                <Text style={[s.body, styles.grow]}>{dayName(d.date)}</Text>
                <Text style={s.muted}>
                  {weatherInfo(d.code).label}{d.snowCm > 0 ? `, ${fmtSnow(d.snowCm, units)}` : ''}
                </Text>
                <Text style={[s.body, styles.temps]}>{fmtTemp(d.maxC, units)} / {fmtTemp(d.minC, units)}</Text>
              </View>
            ))}
          </View>
        </Row>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.xs },
  figures: { fontVariant: ['tabular-nums'] },
  grow: { flex: 1 },
  mapFoot: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  link: { minHeight: target.min, minWidth: target.min, alignItems: 'flex-end', justifyContent: 'center' },
  day: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: space.xxl },
  temps: { minWidth: 96, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
