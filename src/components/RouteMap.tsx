import { useMemo, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle, Text } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { simplify } from '../lib/geo';
import type { TrailMap } from '../lib/trailmap';
import type { Activity, TrackPoint } from '../lib/types';
import { TrailOverlay } from './TrailOverlay';
import { useTheme, useStyles, type Palette, speedColor } from '../theme';
import { mapsAvailable } from '../lib/mapsAvailable';
import { MapPlaceholder } from './MapPlaceholder';

interface Props {
  /** Cleaned track (indices must match `activities`). */
  points: TrackPoint[];
  speeds: number[];
  activities: Activity[];
  cursor?: number | null;
  /** Highlights one activity and dims the rest. */
  focus?: number | null;
  style?: StyleProp<ViewStyle>;
  /** The resort's pistes and lifts, drawn underneath. */
  trail?: TrailMap | null;
  /** Your photos, pinned where they were taken. */
  photos?: { id: string; lat: number; lon: number }[];
  onPhotoPress?: (id: string) => void;
}

interface Line {
  key: string;
  kind: Activity['kind'];
  coords: { latitude: number; longitude: number }[];
  colors?: string[];
  /** Same length as `colors`, all one faded colour, for when another run is focused. */
  dimColors?: string[];
}

const DIM_RUN = 'rgba(11,107,203,0.25)';

/** Your day on a terrain map: runs coloured by speed, lifts dashed. */
export function RouteMap({ points, speeds, activities, cursor, focus, style, trail, photos, onPhotoPress }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const ref = useRef<MapView>(null);

  const lines = useMemo<Line[]>(() => {
    const segs = activities.length
      ? activities
      : points.length > 1
        ? [{ kind: 'other', startIndex: 0, endIndex: points.length - 1 } as Activity]
        : [];
    return segs.map((a, k) => {
      const slice = points.slice(a.startIndex, a.endIndex + 1);
      // Keep the map light: ~3 m simplification, but always enough vertices to show speed changes.
      const keep = slice.length > 400 ? simplify(slice, 3) : slice.map((_, i) => i);
      const coords = keep.map((i) => ({ latitude: slice[i].lat, longitude: slice[i].lon }));
      const line: Line = { key: `${k}-${a.kind}`, kind: a.kind, coords };
      if (a.kind === 'run') {
        line.colors = keep.map((i) => speedColor(speeds[a.startIndex + i] ?? 0));
        line.dimColors = keep.map(() => DIM_RUN);
      }
      return line;
    });
  }, [points, speeds, activities]);

  const allCoords = useMemo(() => {
    if (!points.length) return [];
    const step = Math.max(1, Math.floor(points.length / 300));
    const c = [];
    for (let i = 0; i < points.length; i += step) c.push({ latitude: points[i].lat, longitude: points[i].lon });
    return c;
  }, [points]);

  const fit = () => {
    if (allCoords.length < 2) return;
    ref.current?.fitToCoordinates(allCoords, {
      edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
      animated: false,
    });
  };

  const c = cursor != null ? points[cursor] : null;
  const first = points[0];

  if (!mapsAvailable) return <MapPlaceholder height={280} style={style} />;
  return (
    <View style={[styles.wrap, style]}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={Platform.OS === 'android' ? 'terrain' : 'standard'}
        onMapReady={fit}
        initialRegion={first ? { latitude: first.lat, longitude: first.lon, latitudeDelta: 0.03, longitudeDelta: 0.03 } : undefined}
        toolbarEnabled={false}
        rotateEnabled={false}
      >
        {trail ? <TrailOverlay map={trail} /> : null}
        {lines.map((l, i) => {
          const dim = focus != null && focus !== i;
          if (l.coords.length < 2) return null;
          if (l.kind === 'run') {
            return (
              // Android crashes if strokeColors is ever set to undefined/null after being an
              // array (MapPolyline.setStrokeColors calls .size() on it), so dimmed runs get an
              // array of the faded colour, and the key changes so the line is rebuilt cleanly.
              <Polyline
                key={`${l.key}-${dim ? 'dim' : 'on'}`}
                coordinates={l.coords}
                strokeColors={dim ? l.dimColors : l.colors}
                strokeColor={dim ? DIM_RUN : colors.run}
                strokeWidth={dim ? 3 : 5}
                zIndex={2}
              />
            );
          }
          return (
            <Polyline
              key={l.key}
              coordinates={l.coords}
              strokeColor={l.kind === 'lift' ? (dim ? 'rgba(122,135,151,0.3)' : colors.lift) : 'rgba(120,130,145,0.5)'}
              strokeWidth={l.kind === 'lift' ? 3 : 2}
              lineDashPattern={l.kind === 'lift' ? [8, 6] : undefined}
              zIndex={1}
            />
          );
        })}
        {photos?.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            onPress={() => onPhotoPress?.(p.id)}
            zIndex={4}
          >
            <View style={styles.photoPin}><Text style={{ fontSize: 13 }}>📷</Text></View>
          </Marker>
        ))}
        {c ? (
          <Marker coordinate={{ latitude: c.lat, longitude: c.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.dot} />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { height: 280, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.faint },
    photoPin: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.accent },
    dot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, borderWidth: 3, borderColor: '#fff' },
  });
