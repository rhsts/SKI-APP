import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { createBackup, restoreBackup } from '../../days/files';
import { deleteAllData, deleteDemoData } from '../../db';
import type { Units } from '../../lib/types';
import { updateSettings, useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';
import { addDemoDay } from '../../tracking/demo';
import { useTracker } from '../../tracking/tracker';

export default function ProfileScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const settings = useSettings();
  const { status } = useTracker();
  const [name, setName] = useState(settings.name);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      Alert.alert(done);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={styles.content}>
      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Your name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => updateSettings({ name: name.trim() })}
          placeholder="Shown to friends on challenge leaderboards"
          style={styles.input}
          maxLength={30}
        />
      </View>

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Units</Text>
        <View style={styles.segment}>
          {(['metric', 'imperial'] as Units[]).map((u) => (
            <Pressable key={u} onPress={() => updateSettings({ units: u })} style={[styles.segBtn, settings.units === u && styles.segOn]}>
              <Text style={[styles.segText, settings.units === u && { color: colors.onAccent }]}>
                {u === 'metric' ? 'km/h · m' : 'mph · ft'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Appearance</Text>
        <View style={styles.segment}>
          {(['system', 'light', 'dark'] as const).map((t) => (
            <Pressable key={t} onPress={() => updateSettings({ theme: t })} style={[styles.segBtn, settings.theme === t && styles.segOn]}>
              <Text style={[styles.segText, settings.theme === t && { color: colors.onAccent }]}>
                {t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[s.card, styles.section]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.body}>Vibrate</Text>
            <Text style={s.muted}>Buzz on a new top speed and when a run is finished.</Text>
          </View>
          <Switch value={settings.vibrate} onValueChange={(v) => updateSettings({ vibrate: v })} trackColor={{ true: colors.accent }} />
        </View>
      </View>

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Try it without snow</Text>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.body}>Simulated GPS</Text>
            <Text style={s.muted}>Record plays a fake ski day at 20× speed instead of using real GPS.</Text>
          </View>
          <Switch
            value={settings.simulate}
            disabled={status !== 'idle'}
            onValueChange={(v) => updateSettings({ simulate: v })}
            trackColor={{ true: colors.accent }}
          />
        </View>
        <Row label="Add a demo day" busy={busy === 'add'} onPress={() => act('add', addDemoDay, 'Demo day added to Days')} />
        <Row label="Delete demo days" busy={busy === 'demo'} onPress={() => act('demo', deleteDemoData, 'Demo days deleted')} />
      </View>

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Data</Text>
        <Text style={s.muted}>
          Everything is stored only on this phone. Save a backup to Google Drive or email before you switch phones.
        </Text>
        <Row
          label="Back up all days"
          busy={busy === 'backup'}
          onPress={async () => {
            setBusy('backup');
            try {
              await createBackup();
            } catch (e) {
              Alert.alert('Backup failed', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(null);
            }
          }}
        />
        <Row
          label="Restore from a backup"
          busy={busy === 'restore'}
          onPress={async () => {
            setBusy('restore');
            try {
              const r = await restoreBackup();
              if (r) Alert.alert('Backup restored', `Added ${r.days} ${r.days === 1 ? 'day' : 'days'} and ${r.challenges} ${r.challenges === 1 ? 'challenge' : 'challenges'}. Days you already had were kept.`);
            } catch (e) {
              Alert.alert('Couldn’t restore', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(null);
            }
          }}
        />
        <Row
          label="Delete all ski days"
          danger
          busy={busy === 'all'}
          onPress={() =>
            Alert.alert('Delete all ski days?', 'This removes every recorded day and can’t be undone.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => act('all', deleteAllData, 'All data deleted') },
            ])
          }
        />
      </View>
    </ScrollView>
  );
}

function Row({ label, onPress, danger, busy }: { label: string; onPress: () => void; danger?: boolean; busy?: boolean }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <Text style={[s.body, { color: danger ? colors.danger : colors.accent, fontWeight: '700' }]}>{label}</Text>
      {busy ? <ActivityIndicator color={colors.accent} /> : null}
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    section: { gap: 10 },
    input: { fontSize: 17, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.faint, paddingVertical: 6 },
    segment: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 10, padding: 3 },
    segBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
    segOn: { backgroundColor: colors.accent },
    segText: { fontWeight: '700', color: colors.text },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.faint },
  });
