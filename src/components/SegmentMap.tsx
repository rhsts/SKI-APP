import { useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Circle, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { PathPoint } from '../lib/segments';
import { useTheme, useStyles, type Palette } from '../theme';
import { mapsAvailable } from '../lib/mapsAvailable';
import { MapPlaceholder } from './MapPlaceholder';
import { ViewMarker } from './ViewMarker';

interface Props {
  path: PathPoint[];
  gateRadius?: number;
  /** Faint surrounding track for context, e.g. the whole run while trimming. */
  context?: { lat: number; lon: number }[];
  style?: StyleProp<ViewStyle>;
  /** Moving dots, e.g. you vs a rival's ghost during a race replay. */
  markers?: { key: string; lat: number; lon: number; color: string; label: string }[];
}

/** A challenge course: the line to ski, a green start gate and a chequered finish gate. */
export function SegmentMap({ path, gateRadius = 30, context, style, markers }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const ref = useRef<MapView>(null);
  const coords = useMemo(() => path.map(([latitude, longitude]) => ({ latitude, longitude })), [path]);
  const ctx = useMemo(() => context?.map((p) => ({ latitude: p.lat, longitude: p.lon })), [context]);
  const first = coords[0];
  const last = coords[coords.length - 1];

  const fit = () => {
    const all = ctx && ctx.length > 1 ? ctx : coords;
    if (all.length < 2) return;
    ref.current?.fitToCoordinates(all, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: false });
  };

  if (!mapsAvailable) return <MapPlaceholder height={260} style={style} />;
  if (!first) return <View style={[styles.wrap, style]} />;

  return (
    <View style={[styles.wrap, style]}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={Platform.OS === 'android' ? 'terrain' : 'standard'}
        onMapReady={fit}
        onLayout={fit}
        initialRegion={{ latitude: first.latitude, longitude: first.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
        toolbarEnabled={false}
        rotateEnabled={false}
      >
        {ctx && ctx.length > 1 ? <Polyline coordinates={ctx} strokeColor="rgba(92,107,126,0.45)" strokeWidth={3} /> : null}
        {coords.length > 1 ? <Polyline coordinates={coords} strokeColor={colors.accent} strokeWidth={6} zIndex={2} /> : null}
        <Circle center={first} radius={gateRadius} strokeColor={colors.good} fillColor="rgba(31,157,85,0.18)" />
        {last ? <Circle center={last} radius={gateRadius} strokeColor="#111111" fillColor="rgba(14,27,44,0.15)" /> : null}
        <ViewMarker coordinate={first} anchor={{ x: 0.5, y: 1 }}>
          <View style={[styles.flag, { backgroundColor: colors.good }]}><Text style={styles.flagText}>START</Text></View>
        </ViewMarker>
        {last ? (
          <ViewMarker coordinate={last} anchor={{ x: 0.5, y: 1 }}>
            <View style={[styles.flag, { backgroundColor: '#0E1B2C' }]}><Text style={styles.flagText}>🏁 FINISH</Text></View>
          </ViewMarker>
        ) : null}
        {markers?.map((m) => (
          <ViewMarker key={m.key} coordinate={{ latitude: m.lat, longitude: m.lon }} anchor={{ x: 0.5, y: 0.5 }} zIndex={5}>
            <View style={styles.ghost}>
              <View style={[styles.ghostDot, { backgroundColor: m.color }]} />
              <Text style={[styles.ghostLabel, { backgroundColor: m.color }]} numberOfLines={1}>{m.label}</Text>
            </View>
          </ViewMarker>
        ))}
      </MapView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { height: 260, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.faint },
    flag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    ghost: { alignItems: 'center' },
    ghostDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#fff' },
    ghostLabel: { color: '#fff', fontSize: 10, fontWeight: '800', paddingHorizontal: 4, borderRadius: 3, marginTop: 2, overflow: 'hidden', maxWidth: 80 },
    flagText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  });
