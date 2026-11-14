import { Tap } from './Tap';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { dialog } from '../dialog';
import {
  backupDays, backupStatus, changePassword, logOut, missingBackups, pickAvatar, removeAvatar, restoreDays,
} from '../friends/account';
import { useAvatar } from '../friends/avatars';
import { updateSettings, useSettings } from '../settings';
import { useStyles, useTheme, type Palette } from '../theme';
import { Avatar } from './Avatar';

/** Your account: picture, password, log out, online backup, and (for admins) managing people. */
export function AccountCard() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const settings = useSettings();
  const account = settings.account;
  const myPic = useAvatar(settings.playerId);
  const [busy, setBusy] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [status, setStatus] = useState<{ backedUp: number; total: number; missing: number } | null>(null);

  const refresh = useCallback(() => {
    if (!account) return;
    Promise.all([backupStatus(), missingBackups().catch(() => [])])
      .then(([b, m]) => setStatus({ ...b, missing: m.length }))
      .catch(() => setStatus(null));
  }, [account]);
  useFocusEffect(refresh);

  if (!account) return null;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      dialog('Something went wrong', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const picture = () =>
    dialog('Profile picture', undefined, [
      { text: 'Choose a picture', onPress: () => run('pic', pickAvatar) },
      ...(myPic ? [{ text: 'Remove picture', style: 'destructive' as const, onPress: () => run('pic', removeAvatar) }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);

  const out = () =>
    dialog('Log out?', 'Your days are saved to your account and removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => run('out', async () => {
        const { unsaved } = await logOut();
        if (!unsaved) return;
        dialog(
          `${unsaved} ${unsaved === 1 ? 'day' : 'days'} can’t be saved`,
          `${unsaved === 1 ? 'This day is' : 'These days are'} too big to back up to your account. Logging out removes ${unsaved === 1 ? 'it' : 'them'} from this phone for good.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Log out anyway', style: 'destructive', onPress: () => run('out', () => logOut(true)) },
          ],
        );
      }) },
    ]);

  return (
    <View style={[s.card, styles.section]}>
      <View style={styles.head}>
        <Pressable onPress={picture} accessibilityLabel="Change profile picture">
          {busy === 'pic' ? (
            <View style={styles.picBusy}><ActivityIndicator color={colors.accent} /></View>
          ) : (
            <Avatar playerId={settings.playerId} name={settings.name || account.username} size={64} />
          )}
          <View style={styles.camera}><Ionicons name="camera" size={13} color="#fff" /></View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.h2}>{settings.name || account.username}</Text>
          <Text style={s.muted}>@{account.username}{account.isAdmin ? ' · admin' : ''}</Text>
          <Pressable onPress={() => router.push(`/player/${settings.playerId}`)} hitSlop={6}>
            <Text style={styles.link}>View my profile</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.body}>Back up my days online</Text>
          <Text style={s.muted}>
            Keeps your days and tracks in your account.
            {status && settings.backupDays ? ` ${status.backedUp} of ${status.total} backed up.` : ''}
          </Text>
        </View>
        <Switch
          value={settings.backupDays}
          onValueChange={(v) => {
            updateSettings({ backupDays: v }).then(() => { if (v) run('backup', backupDays); });
          }}
          trackColor={{ true: colors.accent }}
        />
      </View>
      {settings.backupDays ? (
        <Row label="Back up now" busy={busy === 'backup'} onPress={() => run('backup', async () => {
          const { uploaded: n, failed, tooBig } = await backupDays();
          const bad = failed + tooBig;
          dialog('Backup', [
            n ? `${n} ${n === 1 ? 'day' : 'days'} backed up.` : bad ? '' : 'Everything was already backed up.',
            bad ? `${bad} ${bad === 1 ? 'day' : 'days'} couldn’t be backed up${tooBig ? ' (too big)' : ''}.` : '',
          ].filter(Boolean).join(' '));
        })} />
      ) : null}
      {status?.missing ? (
        <Row
          label={`Download ${status.missing} ${status.missing === 1 ? 'day' : 'days'} from my account`}
          busy={busy === 'restore'}
          onPress={() => run('restore', async () => {
            const n = await restoreDays();
            dialog('Days restored', `${n} ${n === 1 ? 'day' : 'days'} added.`);
          })}
        />
      ) : null}

      {pwOpen ? (
        <View style={{ gap: 8 }}>
          <TextInput value={oldPw} onChangeText={setOldPw} placeholder="Current password" secureTextEntry autoCapitalize="none" style={styles.input} placeholderTextColor={colors.muted} />
          <TextInput value={newPw} onChangeText={setNewPw} placeholder="New password (6+ characters)" secureTextEntry autoCapitalize="none" style={styles.input} placeholderTextColor={colors.muted} />
          <Row
            label="Save new password"
            busy={busy === 'pw'}
            onPress={() => run('pw', async () => {
              await changePassword(oldPw, newPw);
              setPwOpen(false);
              setOldPw('');
              setNewPw('');
              dialog('Password changed');
            })}
          />
        </View>
      ) : (
        <Row label="Change password" onPress={() => setPwOpen(true)} />
      )}
      {account.isAdmin ? <Row label="Manage people (admin)" onPress={() => router.push('/admin')} /> : null}
      <Row label="Log out" danger busy={busy === 'out'} onPress={out} />
    </View>
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
    section: { gap: 12 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    picBusy: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.faint },
    camera: { position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.card },
    link: { color: colors.accent, fontWeight: '600', marginTop: 4 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    input: { fontSize: 15, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.faint, paddingVertical: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.faint },
  });
