import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../components/Avatar';
import { FriendsMap, type FriendsMapHandle } from '../../components/FriendsMap';
import { MeetEditor, PinNote } from '../../components/MeetPin';
import { Row, Rows } from '../../components/Row';
import { useTabBarSpace } from '../../components/TabBar';
import { Tap } from '../../components/Tap';
import { listTrailMaps } from '../../db';
import { refreshLive, useLive } from '../../friends/live';
import { cachedGroups } from '../../friends/sync';
import { friendLine, friendsHeadline, sortFriends } from '../../lib/friendsMap';
import type { LatLon } from '../../lib/geo';
import type { Group } from '../../lib/groups';
import { mapFor, nearestFeature, type TrailMap } from '../../lib/trailmap';
import { useSettings } from '../../settings';
import { chromeShadow, font, radius, space, target, useStyles, useTheme, type Palette } from '../../theme';
import { useTracker } from '../../tracking/tracker';

/** How often the open tab asks where everyone is. While you record, the tracker asks too; calls share one request. */
const REFRESH_MS = 20_000;

/**
 * Friends: a map of everyone in your groups who is skiing right now, the meet-up pin,
 * and a short list underneath. The map stays put while the list scrolls. Leaderboards, groups and challenges are one tap away.
 */
export default function FriendsScreen() {
  const { colors, dark, s } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const { height } = useWindowDimensions();
  const { units, serverUrl, shareLive } = useSettings();
  const tracker = useTracker();
  const live = useLive();
  const mapRef = useRef<FriendsMapHandle>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [phone, setPhone] = useState<LatLon | null>(null);
  const [trail, setTrail] = useState<TrailMap | null>(null);
  const [draft, setDraft] = useState<LatLon | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const recording = tracker.status !== 'idle';

  // Where you are: today's last fix while recording, else the phone's last known position (never prompts).
  const last = tracker.points[tracker.points.length - 1];
  const me = useMemo<LatLon | null>(() => (last ? { lat: last.lat, lon: last.lon } : phone), [last, phone]);

  useFocusEffect(useCallback(() => {
    if (!serverUrl) return;
    let on = true;
    cachedGroups().then((g) => on && setGroups(g)).catch(() => on && setGroups([]));
    refreshLive().catch(() => undefined);
    const t = setInterval(() => refreshLive().catch(() => undefined), REFRESH_MS);
    return () => { on = false; clearInterval(t); };
  }, [serverUrl]));

  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(async (p) => {
        if (p.status !== 'granted') return;
        const l = await Location.getLastKnownPositionAsync();
        if (l) setPhone({ lat: l.coords.latitude, lon: l.coords.longitude });
      })
      .catch(() => undefined);
  }, []);

  // The saved piste map around you, so friends show on the runs they're on.
  const spot = me ?? live.friends[0] ?? null;
  const spotKey = spot ? `${spot.lat.toFixed(2)},${spot.lon.toFixed(2)}` : '';
  useEffect(() => {
    if (!spot) return;
    listTrailMaps().then((maps) => setTrail(mapFor(maps, spot))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotKey]);

  const friends = useMemo(() => sortFriends(live.friends, me), [live.friends, me]);
  const mapHeight = Math.round(height * 0.5);

  const meetLabel = (p: LatLon) => {
    const f = trail ? nearestFeature(trail, p, 300) : null;
    return f ? (f.kind === 'lift' ? `Top of ${f.name}` : f.name) : 'Meet here';
  };
  const showFriend = (p: LatLon) => mapRef.current?.focus(p);
  const refresh = () => {
    setRefreshing(true);
    Promise.all([refreshLive(), cachedGroups().then(setGroups)]).catch(() => undefined).finally(() => setRefreshing(false));
  };

  const more = (
    <Rows>
      {serverUrl ? <Row label="Leaderboards" onPress={() => router.push('/boards')} /> : null}
      <Row label={serverUrl ? 'Groups and challenges' : 'Challenges'} onPress={() => router.push('/challenges')} />
    </Rows>
  );

  if (!serverUrl) {
    return (
      <View style={[s.screen, { paddingTop: insets.top + space.lg }]}>
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={44} color={colors.muted} />
          <Text style={s.h2}>See your friends on the mountain</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Set up a friends server under You, then join a group. Everyone in it shows on a live map here while they ski.
          </Text>
          <Pressable onPress={() => router.push('/profile')} style={styles.cta} accessibilityRole="button">
            <Text style={styles.ctaText}>Open You</Text>
          </Pressable>
        </View>
        <View style={{ padding: space.lg }}>{more}</View>
      </View>
    );
  }

  const noGroups = groups != null && groups.length === 0;
  const status = !shareLive
    ? 'You are hidden from friends. Turn on “Show friends where I am” under You.'
    : recording
      ? 'Friends in your groups can see you.'
      : 'Friends see you while you record.';

  return (
    <View style={s.screen}>
      <View>
        <FriendsMap
          ref={mapRef}
          height={mapHeight}
          friends={friends}
          pins={live.pins}
          me={me}
          trail={trail}
          draft={draft}
          onLongPress={noGroups ? undefined : setDraft}
        />
        <View style={[styles.chip, { top: insets.top + space.sm, boxShadow: chromeShadow(dark) }]} pointerEvents="none">
          <View style={[styles.dot, { backgroundColor: friends.length ? colors.accent : colors.muted }]} />
          <Text style={s.control} numberOfLines={1}>{friendsHeadline(friends.length)}</Text>
        </View>
        <Pressable
          onPress={() => mapRef.current?.showAll()}
          style={[styles.fab, { boxShadow: chromeShadow(dark) }]}
          accessibilityRole="button"
          accessibilityLabel="Show everyone on the map"
        >
          <Ionicons name="scan-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* The map stays put and the list scrolls under it, so dragging the map never scrolls the page. */}
      <ScrollView
        style={styles.grow}
        contentContainerStyle={[styles.body, { paddingBottom: tabSpace }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        <View style={styles.status}>
          <Ionicons name={shareLive && recording ? 'radio' : 'eye-off-outline'} size={18} color={shareLive && recording ? colors.accent : colors.muted} />
          <Text style={[s.muted, styles.grow]}>{status}</Text>
        </View>

        {noGroups ? (
          <View style={[s.card, styles.join]}>
            <Text style={s.h2}>Add your friends</Text>
            <Text style={s.muted}>Make a group or join one with a code. Everyone in it shows on this map while they ski.</Text>
            <Pressable onPress={() => router.push('/group/new')} style={styles.cta} accessibilityRole="button">
              <Text style={styles.ctaText}>Make or join a group</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={s.label}>On the mountain</Text>
            {friends.length ? friends.map((f) => (
              <Tap
                key={f.playerId}
                style={styles.friend}
                onPress={() => showFriend(f)}
                accessibilityRole="button"
                accessibilityLabel={`${f.name}, ${friendLine(f, me, units)}. Show on map`}
              >
                <Avatar playerId={f.playerId} name={f.name} size={40} />
                <View style={styles.grow}>
                  <Text style={s.h2} numberOfLines={1}>{f.name}</Text>
                  <Text style={s.muted} numberOfLines={1}>{friendLine(f, me, units)}</Text>
                </View>
                <Pressable
                  onPress={() => router.push(`/player/${f.playerId}`)}
                  hitSlop={8}
                  style={styles.profile}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.name}’s profile`}
                >
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </Pressable>
              </Tap>
            )) : (
              <Text style={s.muted}>Nobody from your groups is skiing right now. When they start recording, they appear here and on the map.</Text>
            )}
          </View>
        )}

        {noGroups ? null : (
          <View style={styles.section}>
            <Text style={s.label}>Meet up</Text>
            {draft ? (
              <MeetEditor key={`${draft.lat},${draft.lon}`} at={draft} label={meetLabel(draft)} onDone={() => setDraft(null)} />
            ) : (
              <>
                {live.pins.map((p) => <PinNote key={p.groupId} pin={p} me={me} units={units} />)}
                <View style={styles.meetFoot}>
                  <Text style={[s.muted, styles.grow]}>Long-press the map to pick a meeting point.</Text>
                  {me ? (
                    <Pressable onPress={() => setDraft(me)} style={styles.button} accessibilityRole="button" accessibilityLabel="Meet here, at my position">
                      <Text style={s.control}>Meet here</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            )}
          </View>
        )}

        {more}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    grow: { flex: 1 },
    body: { padding: space.lg, gap: space.xl },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xxl },
    cta: { alignSelf: 'center', marginTop: space.sm, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill, backgroundColor: colors.accent },
    ctaText: { color: colors.onAccent, fontFamily: font.medium },
    chip: {
      position: 'absolute', left: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm,
      paddingHorizontal: space.lg, minHeight: target.min, borderRadius: radius.pill, backgroundColor: colors.card, maxWidth: '75%',
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    fab: {
      position: 'absolute', right: space.lg, bottom: space.lg, width: target.min, height: target.min,
      borderRadius: radius.pill, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
    },
    status: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    join: { gap: space.sm },
    section: { gap: space.sm },
    friend: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
    profile: { minWidth: target.min, minHeight: target.min, alignItems: 'center', justifyContent: 'center' },
    meetFoot: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
    // 12 = the redesign's radius.control for buttons; switch to the token once it lands in theme.ts.
    button: {
      minHeight: target.min, minWidth: 112, paddingHorizontal: space.lg, borderRadius: 12,
      backgroundColor: colors.faint, alignItems: 'center', justifyContent: 'center',
    },
  });
