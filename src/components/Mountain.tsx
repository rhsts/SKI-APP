import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { listTrailMaps, sessionStarts } from '../db';
import { areaAt, skiAreas, type SkiArea } from '../lib/areas';
import type { Place } from '../lib/geocode';
import { mapFor, type TrailMap } from '../lib/trailmap';
import type { TrackPoint, Units } from '../lib/types';
import { fmtSnow, fmtTemp, fmtWind, weatherInfo, type Weather } from '../lib/weather';
import { downloadTrailMap } from '../mountain/pistes';
import { getWeather } from '../mountain/weather';
import { radius, space, target, useStyles, useTheme, type Palette } from '../theme';
import { LiveMap } from './LiveMap';
import { Figure } from './StatTile';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (date: string) => DAY_NAMES[new Date(`${date}T12:00:00`).getDay()];

type Spot = { lat: number; lon: number; alt: number | null };
const keyOf = (p: Spot | null) => (p ? `${p.lat.toFixed(3)},${p.lon.toFixed(3)}` : '');

export interface Mountain {
  pos: Spot | null;
  /** A place you searched for, instead of where you are. */
  place: Place | null;
  /** The ski area you're at, if you have skied here before. */
  area: SkiArea | null;
  /** What to call this spot: the searched place, else the ski area. */
  name: string | null;
  weather: Weather | null;
  /** The saved offline trail map that covers this spot. */
  trail: TrailMap | null;
  needsPermission: boolean;
  downloading: boolean;
  locate: () => Promise<void>;
  download: () => Promise<void>;
}

/**
 * Snow and weather for a spot, plus its offline trail map: download it before you
 * head up, then open the live map on the mountain without signal. The spot is the
 * place you searched for, else where today's recording started, else where the phone is.
 */
export function useMountain(points: TrackPoint[], place: Place | null = null): Mountain {
  const [known, setKnown] = useState<Spot | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  // Each answer remembers the spot it is for, so a new search never shows the old place's snow.
  const [weather, setWeather] = useState<{ at: string; data: Weather | null } | null>(null);
  const [trail, setTrail] = useState<{ at: string; data: TrailMap | null } | null>(null);
  const [area, setArea] = useState<{ at: string; data: SkiArea | null } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const first = points[0];

  const pos = useMemo<Spot | null>(
    () => (place ? { lat: place.lat, lon: place.lon, alt: place.alt } : first ? { lat: first.lat, lon: first.lon, alt: first.alt } : known),
    [place, first, known],
  );
  const at = keyOf(pos);

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
    const here = keyOf(pos);
    getWeather(pos.lat, pos.lon, pos.alt).then((data) => setWeather({ at: here, data }));
    listTrailMaps().then((maps) => setTrail({ at: here, data: mapFor(maps, pos) }));
    sessionStarts()
      .then((starts) => setArea({ at: here, data: areaAt(skiAreas(starts.filter((x) => !x.isDemo)), pos) }))
      .catch(() => undefined);
  }, [pos]);

  const download = useCallback(async () => {
    if (!pos) return;
    const here = keyOf(pos);
    setDownloading(true);
    try {
      const map = await downloadTrailMap(pos.lat, pos.lon);
      if (map) {
        setTrail({ at: here, data: map });
        Alert.alert('Trail map saved', `${map.pistes.length} pistes and ${map.lifts.length} lifts here are now on your phone, also without signal.`);
      } else {
        Alert.alert('Couldn’t download', 'No connection to the map server. Try again with signal or Wi-Fi.');
      }
    } finally {
      setDownloading(false);
    }
  }, [pos]);

  const areaHere = area?.at === at ? area.data : null;
  return {
    pos,
    place,
    area: areaHere,
    name: place?.name ?? areaHere?.name ?? null,
    weather: weather?.at === at ? weather.data : null,
    trail: trail?.at === at ? trail.data : null,
    needsPermission: needsPermission && !first && !place,
    downloading,
    locate,
    download,
  };
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

/** A few words for the row that opens the details: "14 cm fresh" or "-6°C, clear". */
export function mountainSummary(m: Mountain, units: Units): string | undefined {
  const w = m.weather;
  if (!w) return undefined;
  return w.freshSnowCm > 0 ? `${fmtSnow(w.freshSnowCm, units)} fresh` : `${fmtTemp(w.tempC, units)}, ${weatherInfo(w.code).label.toLowerCase()}`;
}

/** Where you are and what the snow is like, as one quiet heading and a line. Shown before you start. */
export function MountainIntro({ m, units }: { m: Mountain; units: Units }) {
  const { s } = useTheme();
  if (m.needsPermission) {
    return (
      <Pressable style={styles.intro} onPress={() => m.locate().catch(() => undefined)} accessibilityRole="button">
        <Text style={s.h1}>Ready</Text>
        <Text style={s.body}>Allow location, or search a place, to see the snow and the trail map.</Text>
      </Pressable>
    );
  }
  const w = m.weather;
  return (
    <View style={styles.intro}>
      <Text style={s.h1} numberOfLines={1}>{m.name ?? 'Ready'}</Text>
      {w
        ? <Text style={[s.body, styles.figures]} numberOfLines={2}>{conditions(w, units)}</Text>
        : m.pos ? <Text style={s.muted}>Snow and weather load when you have signal.</Text> : null}
      {w ? <Text style={[s.muted, styles.figures]} numberOfLines={2}>{detail(w, units)}</Text> : null}
    </View>
  );
}

/** Everything about the spot, for a sheet: the snow now, the next three days, and the map. */
export function MountainDetails({ m, points, units }: { m: Mountain; points: TrackPoint[]; units: Units }) {
  const { colors, s } = useTheme();
  const themed = useStyles(makeStyles);
  const { pos, weather: w, trail } = m;
  if (!pos) return <Text style={s.body}>Search a resort or place, or allow location, to see the snow and the trail map here.</Text>;

  return (
    <>
      {w ? (
        <>
          <View>
            <Text style={[s.body, styles.figures]}>{conditions(w, units)}</Text>
            <Text style={[s.muted, styles.figures]}>{detail(w, units)}</Text>
            {m.place?.region ? <Text style={s.muted}>{m.place.region}</Text> : null}
            {m.area ? <Text style={s.muted}>{m.area.days} {m.area.days === 1 ? 'day' : 'days'} here before</Text> : null}
          </View>
          <View style={[styles.pair, themed.ruled]}>
            <Figure style={styles.grow} label="Fresh snow, 24 h" value={fmtSnow(w.freshSnowCm, units)} />
            <Figure style={styles.grow} label="Snow depth" value={fmtSnow(w.snowDepthCm, units)} />
          </View>
          <View style={themed.ruled}>
            <Text style={s.label}>Next three days</Text>
            {w.days.slice(0, 3).map((d) => (
              <View key={d.date} style={styles.day}>
                <Text style={[s.body, styles.grow]}>{dayName(d.date)}</Text>
                <Text style={s.muted}>{weatherInfo(d.code).label}{Math.round(d.snowCm) > 0 ? `, ${fmtSnow(d.snowCm, units)}` : ''}</Text>
                <Text style={[s.body, styles.temps]}>{fmtTemp(d.maxC, units)} / {fmtTemp(d.minC, units)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <Text style={s.muted}>Snow and weather load when you have signal.</Text>
      )}

      {/* A searched place can be far away: the map stays on it instead of following the phone. */}
      <LiveMap key={keyOf(pos)} points={points} trail={trail} center={pos} follow={!m.place} />
      <View style={styles.mapFoot}>
        <Text style={[s.muted, styles.grow]}>
          {trail
            ? `${trail.pistes.length} pistes, ${trail.lifts.length} lifts · saved ${new Date(trail.fetchedAt).toLocaleDateString()}`
            : 'Save the pistes and lifts here to use the map without signal.'}
        </Text>
        <Pressable
          onPress={m.download}
          disabled={m.downloading}
          style={themed.button}
          accessibilityRole="button"
          accessibilityLabel={trail ? 'Update trail map' : 'Download trail map'}
        >
          {m.downloading ? <ActivityIndicator color={colors.text} /> : <Text style={s.control}>{trail ? 'Update' : 'Download'}</Text>}
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.xs },
  figures: { fontVariant: ['tabular-nums'] },
  grow: { flex: 1 },
  pair: { flexDirection: 'row', gap: space.lg },
  mapFoot: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  day: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: space.xxl },
  temps: { minWidth: 96, textAlign: 'right', fontVariant: ['tabular-nums'] },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    ruled: { paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faint },
    button: {
      minHeight: target.min, minWidth: 112, paddingHorizontal: space.lg, borderRadius: radius.card,
      backgroundColor: colors.faint, alignItems: 'center', justifyContent: 'center',
    },
  });
