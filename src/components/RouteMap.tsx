import { useMemo, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { simplify } from '../lib/geo';
import type { Activity, TrackPoint } from '../lib/types';
import { colors, speedColor } from '../theme';

interface Props {
  /** Cleaned track (indices must match `activities`). */
  points: TrackPoint[];
  speeds: number[];
  activities: Activity[];
  cursor?: number | null;
  /** Highlights one activity and dims the rest. */
  focus?: number | null;
  style?: StyleProp<ViewStyle>;
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
export function RouteMap({ points, speeds, activities, cursor, focus, style }: Props) {
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
        {c ? (
          <Marker coordinate={{ latitude: c.lat, longitude: c.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.dot} />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 280, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.faint },
  dot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, borderWidth: 3, borderColor: '#fff' },
});
