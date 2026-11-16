import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { dialog } from '../dialog';
import { api } from '../friends/api';
import { refreshLive, type LivePin } from '../friends/live';
import { cachedGroups } from '../friends/sync';
import type { LatLon } from '../lib/geo';
import type { Group } from '../lib/groups';
import { parseMeetTime, pinText, pinWay } from '../lib/meet';
import type { Units } from '../lib/types';
import { font, radius, size, space, target, useStyles, useTheme, type Palette } from '../theme';
import { Options } from './Options';

/** Drop a meet-up pin at `at`: a label (pre-filled with the nearest lift or place), an optional time, and which group. */
export function MeetEditor({ at, label: suggested, onDone }: { at: LatLon; label: string; onDone: () => void }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const [label, setLabel] = useState(suggested);
  const [time, setTime] = useState('');
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    cachedGroups().then((g) => {
      setGroups(g);
      setGroupId(g[0]?.id ?? '');
    }).catch(() => setGroups([]));
  }, []);

  const meetAt = time.trim() ? parseMeetTime(time) : null;
  const badTime = !!time.trim() && meetAt == null;

  const drop = async () => {
    if (!groupId || badTime || busy) return;
    setBusy(true);
    try {
      await api.setPin(groupId, { lat: at.lat, lon: at.lon, label: label.trim() || 'Meet here', meetAt });
      await refreshLive().catch(() => undefined);
      onDone();
    } catch (e) {
      dialog('Couldn’t drop the pin', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (groups && !groups.length) return <Text style={s.body}>Join a group under Friends to meet up with people.</Text>;
  return (
    <View style={styles.wrap}>
      <Text style={s.label}>Meet up</Text>
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Lunch at the top of the gondola"
        placeholderTextColor={colors.muted}
        maxLength={60}
        style={styles.input}
        accessibilityLabel="Where to meet"
      />
      <TextInput
        value={time}
        onChangeText={setTime}
        placeholder="Time, e.g. 12:30 (optional)"
        placeholderTextColor={colors.muted}
        keyboardType="numbers-and-punctuation"
        style={styles.input}
        accessibilityLabel="Meet-up time"
      />
      {badTime ? <Text style={s.muted}>Type a time like 12:30.</Text> : null}
      {groups && groups.length > 1 ? (
        <Options label="Group" options={groups.map((g) => ({ id: g.id, label: g.name }))} value={groupId} onChange={setGroupId} />
      ) : null}
      <View style={styles.buttons}>
        <Pressable onPress={onDone} style={styles.plain} accessibilityRole="button">
          <Text style={[s.control, { color: colors.muted }]}>Cancel</Text>
        </Pressable>
        <Pressable onPress={drop} disabled={!groupId || badTime || busy} style={styles.solid} accessibilityRole="button" accessibilityLabel="Drop pin">
          {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={[s.control, { color: colors.bg }]}>Drop pin</Text>}
        </Pressable>
      </View>
    </View>
  );
}

/** The group's pin under the map: what, when, how far and which way, and Clear for whoever set it. */
export function PinNote({ pin, me, units }: { pin: LivePin; me: LatLon | null; units: Units }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const clear = () =>
    dialog('Clear the meet-up pin?', `${pinText(pin)} · ${pin.groupName}`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          api.clearPin(pin.groupId)
            .then(() => refreshLive())
            .catch((e) => dialog('Couldn’t clear the pin', e instanceof Error ? e.message : String(e)));
        },
      },
    ]);
  return (
    <View style={styles.note}>
      <View style={styles.grow}>
        <Text style={s.control} numberOfLines={2}>{pinText(pin)}</Text>
        <Text style={s.muted} numberOfLines={2}>
          {[me ? pinWay(me, pin, units) : null, pin.mine ? 'You set it' : `Set by ${pin.createdByName}`, pin.groupName].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {pin.mine ? (
        <Pressable onPress={clear} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear meet-up pin">
          <Text style={[s.control, { color: colors.danger }]}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { gap: space.sm },
    input: {
      minHeight: target.min, fontFamily: font.regular, fontSize: size.body, color: colors.text,
      borderBottomWidth: 1, borderBottomColor: colors.text, paddingVertical: space.xs,
    },
    buttons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: space.lg, marginTop: space.sm },
    plain: { minHeight: target.min, justifyContent: 'center' },
    solid: {
      minHeight: target.min, minWidth: 112, paddingHorizontal: space.lg, borderRadius: radius.card,
      backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center',
    },
    note: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
    grow: { flex: 1 },
    clear: { minHeight: target.min, justifyContent: 'center' },
  });
