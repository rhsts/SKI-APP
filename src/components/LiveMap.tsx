import { useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { TrailMap } from '../lib/trailmap';
import type { TrackPoint } from '../lib/types';
import { radius, useStyles, useTheme, type Palette } from '../theme';
import { TrailOverlay } from './TrailOverlay';
import { mapsAvailable } from '../lib/mapsAvailable';
import { MapPlaceholder } from './MapPlaceholder';

/** Where you are now, today's track, and the resort's pistes and lifts. */
export function LiveMap({ points, trail, center }: { points: TrackPoint[]; trail: TrailMap | null; center: { lat: number; lon: number } }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const track = useMemo(() => {
    const step = Math.max(1, Math.floor(points.length / 800));
    return points.filter((_, i) => i % step === 0 || i === points.length - 1).map((p) => ({ latitude: p.lat, longitude: p.lon }));
  }, [points]);
  // followsUserLocation is iOS-only: on Android, move the camera to each new location ourselves,
  // but leave the map alone for 30 s after the user drags it.
  const mapRef = useRef<MapView>(null);
  const pausedUntil = useRef(0);
  if (!mapsAvailable) return <MapPlaceholder height={320} />;
  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        mapType={Platform.OS === 'android' ? 'terrain' : 'standard'}
        initialRegion={{ latitude: center.lat, longitude: center.lon, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
        showsUserLocation
        followsUserLocation
        onPanDrag={() => { pausedUntil.current = Date.now() + 30_000; }}
        onUserLocationChange={(e) => {
          const c = e.nativeEvent.coordinate;
          if (Platform.OS !== 'android' || !c || Date.now() < pausedUntil.current) return;
          mapRef.current?.animateCamera({ center: { latitude: c.latitude, longitude: c.longitude } }, { duration: 500 });
        }}
        showsMyLocationButton
        toolbarEnabled={false}
      >
        {trail ? <TrailOverlay map={trail} /> : null}
        {track.length > 1 ? <Polyline coordinates={track} strokeColor={colors.accent} strokeWidth={4} zIndex={2} /> : null}
      </MapView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { height: 320, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.faint },
  });
