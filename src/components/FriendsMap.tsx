import { Ionicons } from '@expo/vector-icons';
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { useAvatar } from '../friends/avatars';
import type { LivePin } from '../friends/live';
import { regionFor } from '../lib/friendsMap';
import type { LatLon } from '../lib/geo';
import type { LiveMember } from '../lib/groups';
import { mapsAvailable } from '../lib/mapsAvailable';
import type { TrailMap } from '../lib/trailmap';
import { font, radius, size, space, useStyles, useTheme, type Palette } from '../theme';
import { Avatar } from './Avatar';
import { MapPlaceholder } from './MapPlaceholder';
import { TrailOverlay } from './TrailOverlay';
import { ViewMarker } from './ViewMarker';

export interface FriendsMapHandle {
  /** Fly to one spot, e.g. a friend you tapped in the list. */
  focus: (p: LatLon) => void;
  /** Frame you, everyone on the mountain and the meet-up pins. */
  showAll: () => void;
}

interface Props {
  ref?: Ref<FriendsMapHandle>;
  height: number;
  friends: LiveMember[];
  pins: LivePin[];
  me: LatLon | null;
  trail: TrailMap | null;
  draft?: LatLon | null;
  /** Long-press: drop a meet-up pin there. */
  onLongPress?: (p: LatLon) => void;
}

const EDGE = { top: 96, right: 48, bottom: 48, left: 48 };

/** The Friends tab's map: everyone in your groups who is skiing now, with their picture and name. */
export function FriendsMap({ ref, height, friends, pins, me, trail, draft, onLongPress }: Props) {
  const mapRef = useRef<MapView>(null);
  const spots = useMemo<LatLon[]>(
    () => [...(me ? [me] : []), ...friends, ...pins],
    [me, friends, pins],
  );
  const showAll = () => {
    if (spots.length > 1) {
      mapRef.current?.fitToCoordinates(spots.map((p) => ({ latitude: p.lat, longitude: p.lon })), { edgePadding: EDGE, animated: true });
    } else {
      mapRef.current?.animateToRegion(regionFor(spots), 500);
    }
  };
  useImperativeHandle(ref, () => ({
    focus: (p) => mapRef.current?.animateCamera({ center: { latitude: p.lat, longitude: p.lon }, zoom: 15 }, { duration: 500 }),
    showAll,
  }));

  // Frame everyone once, when the first position arrives (yours or a friend's): after that the map is yours to move.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !spots.length) return;
    framed.current = true;
    const t = setTimeout(showAll, 300); // after the map has laid out
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots.length]);

  if (!mapsAvailable) return <MapPlaceholder height={height} style={{ borderRadius: 0 }} />;
  return (
    <View style={{ height }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        mapType="terrain"
        initialRegion={regionFor(spots)}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        onLongPress={onLongPress ? (e) => {
          const c = e.nativeEvent.coordinate;
          onLongPress({ lat: c.latitude, lon: c.longitude });
        } : undefined}
      >
        {trail ? <TrailOverlay map={trail} /> : null}
        {friends.map((f) => <FriendMarker key={f.playerId} friend={f} />)}
        {pins.map((p) => <PinMarker key={`${p.groupId}:${p.createdAt}`} at={p} />)}
        {draft ? <PinMarker key={`draft:${draft.lat},${draft.lon}`} at={draft} outline /> : null}
      </MapView>
    </View>
  );
}

/** A friend's picture (or initials) in a ring, with their first name underneath. */
function FriendMarker({ friend: f }: { friend: LiveMember }) {
  const styles = useStyles(makeStyles);
  const uri = useAvatar(f.playerId); // same cache as Avatar: only here to redraw the marker once the picture arrives
  const first = f.name.trim().split(/\s+/)[0] || '?';
  return (
    <ViewMarker
      coordinate={{ latitude: f.lat, longitude: f.lon }}
      anchor={{ x: 0.5, y: 0.35 }}
      zIndex={3}
      redraw={`${uri ? 'pic' : 'none'}:${first}`}
      title={f.name}
    >
      <View style={styles.marker} accessibilityLabel={f.name}>
        <View style={styles.ring}><Avatar playerId={f.playerId} name={f.name} size={FACE} /></View>
        <View style={styles.tag}><Text style={styles.tagText} numberOfLines={1}>{first}</Text></View>
      </View>
    </ViewMarker>
  );
}

function PinMarker({ at, outline }: { at: LatLon; outline?: boolean }) {
  const { colors } = useTheme();
  return (
    <ViewMarker coordinate={{ latitude: at.lat, longitude: at.lon }} anchor={{ x: 0.5, y: 1 }} zIndex={outline ? 5 : 4}>
      <Ionicons name={outline ? 'flag-outline' : 'flag'} size={32} color={colors.text} />
    </ViewMarker>
  );
}

const FACE = 40;
const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    marker: { alignItems: 'center', width: 96 },
    ring: { padding: 2, borderRadius: radius.pill, backgroundColor: colors.card, elevation: 3 },
    tag: { marginTop: 2, paddingHorizontal: space.sm, borderRadius: radius.pill, backgroundColor: colors.card, maxWidth: 96 },
    tagText: { color: colors.text, fontFamily: font.medium, fontSize: size.caption, lineHeight: 18 },
  });
