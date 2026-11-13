import { Tap } from '../../components/Tap';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
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

export default function ProfileScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const settings = useSettings();
  const { status } = useTracker();
  const [name, setName] = useState(settings.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [server, setServer] = useState(settings.serverUrl);
  const [password, setPassword] = useState(settings.serverPassword);

  const connect = async () => {
    const url = normalizeServerUrl(server);
    if (!url) {
      Alert.alert('That’s not a web address', 'Type the address of your friends server, e.g. https://ski.example.com or http://192.168.1.20:8787');
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
      Alert.alert('Connected', 'You can now make or join a friend group under Challenges.');
    } catch (e) {
      Alert.alert('Couldn’t connect', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

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
      <AccountCard />

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Your name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => updateSettings({ name: name.trim() })}
          placeholder="Shown to friends on challenge leaderboards"
          style={styles.input}
          placeholderTextColor={colors.muted}
          maxLength={30}
        />
      </View>

      <View style={[s.card, styles.section]}>
        <Text style={s.label}>Friends server</Text>
        <Text style={s.muted}>
          For your account, friend groups and group challenges. Your friends use the same address. Friends only see
          day totals, challenge times and your profile; GPS tracks are only stored for your own online backup.
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
                Alert.alert('Disconnect from the friends server?', 'This locks the app: you’ll need the server address and password to get back in. Your days stay on this phone.', [
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
                <Text style={s.muted}>Also put demo and simulated days on group leaderboards, to try it out.</Text>
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
            <Text style={s.body}>Remind me to start recording</Text>
            <Text style={s.muted}>A notification when you arrive at a ski area you’ve skied before.</Text>
          </View>
          <Switch
            value={settings.remindStart}
            onValueChange={async (v) => {
              if (v) {
                const problem = await requestReminderPermissions();
                if (problem) {
                  Alert.alert('Can’t set up reminders', problem);
                  return;
                }
              }
              await updateSettings({ remindStart: v });
              const n = await refreshGeofences().catch(() => 0);
              if (v) Alert.alert('Reminders on', n ? `Watching ${n} ski ${n === 1 ? 'area' : 'areas'} you’ve visited.` : 'You’ll get reminders once you’ve recorded a day somewhere.');
            }}
            trackColor={{ true: colors.accent }}
          />
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
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.body}>Jumps and falls</Text>
            <Text style={s.muted}>Use the motion sensor to log your airtime and falls. Works while the app is open on screen.</Text>
          </View>
          <Switch value={settings.motion} onValueChange={(v) => updateSettings({ motion: v })} trackColor={{ true: colors.accent }} />
        </View>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.body}>Check on me after a fall</Text>
            <Text style={s.muted}>After a hard fall, ask if you’re OK. No answer within a minute opens the SOS screen.</Text>
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
          label="Import ski days (Slopes, GPX from Strava, watch…)"
          busy={busy === 'gpx'}
          onPress={async () => {
            setBusy('gpx');
            try {
              const r = await importTracks();
              if (r) {
                Alert.alert(
                  'Import finished',
                  `Added ${r.added} ${r.added === 1 ? 'day' : 'days'}` +
                    `${r.skipped ? `, skipped ${r.skipped} already in the app` : ''}` +
                    `${r.failed ? `, ${r.failed} ${r.failed === 1 ? 'file' : 'files'} couldn’t be read` : ''}.`,
                );
              }
            } catch (e) {
              Alert.alert('Couldn’t import', e instanceof Error ? e.message : String(e));
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
          label="Delete saved trail maps"
          busy={busy === 'maps'}
          onPress={() => act('maps', deleteTrailMaps, 'Saved trail maps deleted')}
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
    <Tap onPress={onPress} disabled={busy} style={styles.row}>
      <Text style={[s.body, { color: danger ? colors.danger : colors.accent, fontWeight: '600' }]}>{label}</Text>
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
