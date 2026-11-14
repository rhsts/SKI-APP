import { Tap } from '../../components/Tap';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { dialog } from '../../dialog';
import { createBackup, importTracks, restoreBackup } from '../../days/files';
import { deleteAllData, deleteDemoData, deleteTrailMaps } from '../../db';
import type { Units } from '../../lib/types';
import { updateSettings, useSettings } from '../../settings';
import { useTheme, useStyles, type Palette } from '../../theme';
import { addDemoDay } from '../../tracking/demo';
import { AccountCard } from '../../components/AccountCard';
import { checkServer } from '../../friends/api';
import { resetFriendsCache, syncFriends } from '../../friends/sync';
import { normalizeServerUrl } from '../../lib/groups';
import { refreshGeofences, requestReminderPermissions } from '../../tracking/geofence';
import { useTracker } from '../../tracking/tracker';
import { Row as LinkRow, Rows } from '../../components/Row';
import { useTabBarSpace } from '../../components/TabBar';
import { router } from 'expo-router';

export default function ProfileScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const settings = useSettings();
  const { status } = useTracker();
  const tabSpace = useTabBarSpace();
  const [name, setName] = useState(settings.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [server, setServer] = useState(settings.serverUrl);
  const [password, setPassword] = useState(settings.serverPassword);

  const connect = async () => {
    const url = normalizeServerUrl(server);
    if (!url) {
      dialog('That’s not a web address', 'For example https://ski.example.com');
      return;
    }
    setBusy('server');
    try {
      const pw = password.trim();
      await checkServer(url, pw);
      if (url !== settings.serverUrl) await resetFriendsCache();
      await updateSettings({ serverUrl: url, serverPassword: pw });
      setServer(url);
      await syncFriends();
      dialog('Connected');
    } catch (e) {
      dialog('Couldn’t connect', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      dialog(done);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}>
      {/* Season has no tab of its own any more: it opens from here. */}
      <Rows>
        <LinkRow label="Season" onPress={() => router.push('/season')} />
      </Rows>
      <AccountCard />

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Your name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => updateSettings({ name: name.trim() })}
          placeholder="Shown to friends"
          style={styles.input}
          placeholderTextColor={colors.muted}
          maxLength={30}
        />
      </View>

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Friends server</Text>
        <Text style={s.muted}>
          Friends see your day totals, challenge times and profile. Not your GPS tracks.
        </Text>
        <TextInput
          value={server}
          onChangeText={setServer}
          placeholder="https://ski.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
          placeholderTextColor={colors.muted}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Server password (if it has one)"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
          placeholderTextColor={colors.muted}
          onSubmitEditing={connect}
        />
        <Row label={settings.serverUrl ? 'Reconnect' : 'Connect'} busy={busy === 'server'} onPress={connect} />
        {settings.serverUrl ? (
          <>
            <Row
              label="Disconnect"
              danger
              onPress={() =>
                dialog('Disconnect from the friends server?', 'This locks the app until you reconnect. Your days stay on this phone.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Disconnect',
                    style: 'destructive',
                    onPress: async () => {
                      await updateSettings({ serverUrl: '', serverPassword: '', unlocked: false });
                      await resetFriendsCache();
                      setServer('');
                      setPassword('');
                    },
                  },
                ])
              }
            />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.body}>Share demo days</Text>
                <Text style={s.muted}>Put demo days on group leaderboards.</Text>
              </View>
              <Switch
                value={settings.shareDemoDays}
                onValueChange={async (v) => {
                  await updateSettings({ shareDemoDays: v });
                  syncFriends().catch(() => undefined);
                }}
                trackColor={{ true: colors.accent }}
              />
            </View>
          </>
        ) : null}
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
            <Text style={s.body}>Remind me to record</Text>
            <Text style={s.muted}>When you arrive at a ski area you know.</Text>
          </View>
          <Switch
            value={settings.remindStart}
            onValueChange={async (v) => {
              if (v) {
                const problem = await requestReminderPermissions();
                if (problem) {
                  dialog('Can’t set up reminders', problem);
                  return;
                }
              }
              await updateSettings({ remindStart: v });
              const n = await refreshGeofences().catch(() => 0);
              if (v) dialog('Reminders on', n ? `Watching ${n} ski ${n === 1 ? 'area' : 'areas'}.` : 'Starts after your first recorded day.');
            }}
            trackColor={{ true: colors.accent }}
          />
        </View>
      </View>

      <View style={[s.card, styles.section]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.body}>Vibrate</Text>
            <Text style={s.muted}>On a new top speed and at the end of a run.</Text>
          </View>
          <Switch value={settings.vibrate} onValueChange={(v) => updateSettings({ vibrate: v })} trackColor={{ true: colors.accent }} />
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.body}>Jumps and falls</Text>
            <Text style={s.muted}>Counted while the app is on screen.</Text>
          </View>
          <Switch value={settings.motion} onValueChange={(v) => updateSettings({ motion: v })} trackColor={{ true: colors.accent }} />
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.body}>Check on me after a fall</Text>
            <Text style={s.muted}>No answer within a minute opens SOS.</Text>
          </View>
          <Switch
            value={settings.fallCheck}
            disabled={!settings.motion}
            onValueChange={(v) => updateSettings({ fallCheck: v })}
            trackColor={{ true: colors.accent }}
          />
        </View>
      </View>

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Try it without snow</Text>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.body}>Simulated GPS</Text>
            <Text style={s.muted}>Record plays a demo day at 20× speed.</Text>
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
          Stored on this phone only. Back up before you switch phones.
        </Text>
        <Row
          label="Back up all days"
          busy={busy === 'backup'}
          onPress={async () => {
            setBusy('backup');
            try {
              await createBackup();
            } catch (e) {
              dialog('Backup failed', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(null);
            }
          }}
        />
        <Row
          label="Import days (Slopes, GPX)"
          busy={busy === 'gpx'}
          onPress={async () => {
            setBusy('gpx');
            try {
              const r = await importTracks();
              if (r) {
                dialog(
                  'Import finished',
                  `Added ${r.added} ${r.added === 1 ? 'day' : 'days'}` +
                    `${r.skipped ? `, skipped ${r.skipped} already in the app` : ''}` +
                    `${r.failed ? `, ${r.failed} ${r.failed === 1 ? 'file' : 'files'} couldn’t be read` : ''}.`,
                );
              }
            } catch (e) {
              dialog('Couldn’t import', e instanceof Error ? e.message : String(e));
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
              if (r) dialog('Backup restored', `Added ${r.days} ${r.days === 1 ? 'day' : 'days'} and ${r.challenges} ${r.challenges === 1 ? 'challenge' : 'challenges'}.`);
            } catch (e) {
              dialog('Couldn’t restore', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(null);
            }
          }}
        />
        <Row
          label="Delete saved trail maps"
          busy={busy === 'maps'}
          onPress={() => act('maps', deleteTrailMaps, 'Saved trail maps deleted')}
        />
        <Row
          label="Delete all ski days"
          danger
          busy={busy === 'all'}
          onPress={() =>
            dialog('Delete all ski days?', 'This can’t be undone.', [
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
    <Tap onPress={onPress} disabled={busy} style={styles.row}>
      <Text style={[s.control, { color: danger ? colors.danger : colors.accent }]}>{label}</Text>
      {busy ? <ActivityIndicator color={colors.accent} /> : null}
    </Tap>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    section: { gap: 12 },
    input: { fontSize: 17, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.faint, paddingVertical: 8 },
    segment: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 12, padding: 4 },
    segBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
    segOn: { backgroundColor: colors.accent },
    segText: { fontWeight: '600', color: colors.text },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.faint },
  });
