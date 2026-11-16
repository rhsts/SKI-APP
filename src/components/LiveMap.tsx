import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { LivePin } from '../friends/live';
import type { LatLon } from '../lib/geo';
import type { LiveMember } from '../lib/groups';
import type { TrailMap } from '../lib/trailmap';
import type { TrackPoint } from '../lib/types';
import { radius, useStyles, useTheme, type Palette } from '../theme';
import { TrailOverlay } from './TrailOverlay';
import { mapsAvailable } from '../lib/mapsAvailable';
import { MapPlaceholder } from './MapPlaceholder';
import { ViewMarker } from './ViewMarker';

interface Props {
  points: TrackPoint[];
  trail: TrailMap | null;
  center: { lat: number; lon: number };
  /** Keep the map on the phone's position. Off for a place you searched for. */
  follow?: boolean;
  /** Friends in your groups, where they were last seen. */
  friends?: LiveMember[];
  /** Your groups' meet-up pins. */
  pins?: LivePin[];
  /** A pin being dropped, before it is sent. */
  draft?: LatLon | null;
  /** Long-press: drop a meet-up pin there. */
  onLongPress?: (p: LatLon) => void;
}

/** Where you are now, today's track, the resort's pistes and lifts, your friends and the meet-up pin. */
export function LiveMap({ points, trail, center, follow = true, friends = [], pins = [], draft, onLongPress }: Props) {
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
        followsUserLocation={follow}
        onPanDrag={() => { pausedUntil.current = Date.now() + 30_000; }}
        onLongPress={onLongPress ? (e) => {
          const c = e.nativeEvent.coordinate;
          pausedUntil.current = Date.now() + 30_000;
          onLongPress({ lat: c.latitude, lon: c.longitude });
        } : undefined}
        onUserLocationChange={(e) => {
          const c = e.nativeEvent.coordinate;
          if (!follow || Platform.OS !== 'android' || !c || Date.now() < pausedUntil.current) return;
          mapRef.current?.animateCamera({ center: { latitude: c.latitude, longitude: c.longitude } }, { duration: 500 });
        }}
        showsMyLocationButton
        toolbarEnabled={false}
      >
        {trail ? <TrailOverlay map={trail} /> : null}
        {track.length > 1 ? <Polyline coordinates={track} strokeColor={colors.accent} strokeWidth={4} zIndex={2} /> : null}
        {friends.map((f) => (
          <ViewMarker key={f.playerId} coordinate={{ latitude: f.lat, longitude: f.lon }} anchor={{ x: 0.5, y: 0.5 }} zIndex={3}>
            <View style={styles.friend}><Text style={styles.initial}>{(f.name.trim()[0] ?? '?').toUpperCase()}</Text></View>
          </ViewMarker>
        ))}
        {pins.map((p) => (
          <ViewMarker key={`${p.groupId}:${p.createdAt}`} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 1 }} zIndex={4}>
            <Ionicons name="flag" size={32} color={colors.danger} />
          </ViewMarker>
        ))}
        {draft ? (
          <ViewMarker key={`draft:${draft.lat},${draft.lon}`} coordinate={{ latitude: draft.lat, longitude: draft.lon }} anchor={{ x: 0.5, y: 1 }} zIndex={5}>
            <Ionicons name="flag-outline" size={32} color={colors.danger} />
          </ViewMarker>
        ) : null}
      </MapView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { height: 320, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.faint },
    friend: {
      width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.onAccent,
      alignItems: 'center', justifyContent: 'center',
    },
    initial: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
  });
