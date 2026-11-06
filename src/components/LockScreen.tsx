import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { api, checkServer, FriendsError } from '../friends/api';
import { createAccount, logIn, restoreDays } from '../friends/account';
import { resetFriendsCache, syncFriends } from '../friends/sync';
import { normalizeServerUrl, parseInvite } from '../lib/groups';
import { getSettings, updateSettings, useSettings } from '../settings';
import { useStyles, useTheme, type Palette } from '../theme';

/**
 * The app is private: it only opens for people who know your friends server's
 * address and password, and then an account (created here or logged in to).
 * Once unlocked it stays open, also offline. If the server password changes,
 * the app locks again the next time it's online.
 */
export function LockScreen() {
  const settings = useSettings();
  const [code, setCode] = useState<string | null>(null);
  return settings.unlocked ? <AccountStep code={code} /> : <ServerStep code={code} setCode={setCode} />;
}

function ServerStep({ code, setCode }: { code: string | null; setCode: (c: string | null) => void }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const settings = useSettings();
  const [server, setServer] = useState(settings.serverUrl);
  const [password, setPassword] = useState(settings.serverPassword);
  const [name, setName] = useState(settings.name);
  const [busy, setBusy] = useState(false);

  const paste = async () => {
    const info = parseInvite((await Clipboard.getStringAsync()) ?? '');
    if (!info.server) {
      Alert.alert('No invite found', 'Copy the whole invite message your friend sent you, then tap Paste invite again.');
      return;
    }
    setServer(info.server);
    if (info.password) setPassword(info.password);
    setCode(info.code);
  };

  const unlock = async () => {
    const url = normalizeServerUrl(server);
    if (!url) {
      Alert.alert('Check the server address', 'It looks like https://skipi.tail1a2b.ts.net');
      return;
    }
    setBusy(true);
    try {
      const pw = password.trim();
      await checkServer(url, pw);
      if (url !== getSettings().serverUrl) await resetFriendsCache();
      await updateSettings({ serverUrl: url, serverPassword: pw, name: name.trim(), unlocked: true });
      await syncFriends().catch(() => undefined);
      // Next: create an account or log in (AccountStep); a group from the invite is joined after that.
    } catch (e) {
      Alert.alert('Couldn’t unlock', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Ionicons name="lock-closed" size={36} color={colors.onAccent} />
        </View>
        <Text style={[s.h1, { textAlign: 'center' }]}>Ski Tracker is private</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Only for our crew. Enter the server address and password a friend sent you. You only need to do this once.
        </Text>

        <Pressable style={({ pressed }) => [styles.paste, pressed && { opacity: 0.8 }]} onPress={paste}>
          <Ionicons name="clipboard-outline" size={18} color={colors.accent} />
          <Text style={styles.pasteText}>Paste invite from a friend</Text>
        </Pressable>

        <View style={[s.card, { gap: 12 }]}>
          <Field label="Server address">
            <TextInput
              value={server}
              onChangeText={setServer}
              placeholder="https://skipi.tail1a2b.ts.net"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
              placeholderTextColor={colors.muted}
            />
          </Field>
          <Field label="Password">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Server password"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
              placeholderTextColor={colors.muted}
            />
          </Field>
          <Field label="Your name">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Shown to your friends"
              style={styles.input}
              maxLength={30}
              placeholderTextColor={colors.muted}
              onSubmitEditing={unlock}
            />
          </Field>
          {code ? <Text style={s.muted}>You’ll join group <Text style={{ fontWeight: '800' }}>{code}</Text> too.</Text> : null}
          <Pressable
            onPress={unlock}
            disabled={busy || !server.trim()}
            style={({ pressed }) => [styles.btn, (busy || !server.trim()) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Ionicons name="lock-open" size={20} color={colors.onAccent} />}
            <Text style={styles.btnText}>Unlock</Text>
          </Pressable>
        </View>

        <Text style={[s.muted, { textAlign: 'center', fontSize: 12 }]}>
          Running the server yourself? See server/SETUP-PI.md in the app’s GitHub repository.
        </Text>

        {__DEV__ ? (
          // Development (Expo Go) only, so the app can be tried without a server. Not in the installed app.
          <Pressable onPress={() => updateSettings({ unlocked: true, devSkip: true })} hitSlop={10}>
            <Text style={[s.muted, { textAlign: 'center', textDecorationLine: 'underline' }]}>Skip (development build only)</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Step 2: every friend has an account, so they can log in on any phone. */
function AccountStep({ code }: { code: string | null }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const settings = useSettings();
  const [mode, setMode] = useState<'create' | 'login'>('create');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(settings.name);
  const [busy, setBusy] = useState(false);

  const done = async () => {
    if (code) {
      // The invite came with a group: join it now.
      const g = await api.joinGroup(code).catch(() => null);
      await syncFriends().catch(() => undefined);
      if (g) router.push(`/group/${g.id}`);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'create') {
        await createAccount(username, password, name);
        await done();
      } else {
        const missing = await logIn(username, password);
        await done();
        if (missing > 0) {
          Alert.alert(
            'Welcome back!',
            `${missing} ${missing === 1 ? 'day is' : 'days are'} backed up in your account but not on this phone. Download ${missing === 1 ? 'it' : 'them'} now?`,
            [
              { text: 'Later', style: 'cancel' },
              {
                text: 'Download',
                onPress: () => {
                  restoreDays()
                    .then((n) => Alert.alert('Days restored', `${n} ${n === 1 ? 'day' : 'days'} added. You’ll find them under Days.`))
                    .catch((e) => Alert.alert('Couldn’t restore', e instanceof Error ? e.message : String(e)));
                },
              },
            ],
          );
        }
      }
    } catch (e) {
      if (e instanceof FriendsError && e.status === 404) {
        Alert.alert(
          'The server needs an update',
          'Your friends server doesn’t know accounts yet. On the Raspberry Pi, in the SKI-APP/server folder, run:\n\ngit pull && docker compose up -d --build\n\nThen try again.',
        );
        return;
      }
      Alert.alert(mode === 'create' ? 'Couldn’t create your account' : 'Couldn’t log in', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = username.trim().length >= 3 && password.length >= 6;
  return (
    <KeyboardAvoidingView style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Ionicons name="person" size={36} color={colors.onAccent} />
        </View>
        <Text style={[s.h1, { textAlign: 'center' }]}>{mode === 'create' ? 'Create your account' : 'Log in'}</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>
          {mode === 'create'
            ? 'With an account you can log in on any phone, your days are backed up, and friends see your profile.'
            : 'Log in with the username and password of your account. Your groups and backed-up days come along.'}
        </Text>

        <View style={styles.tabs}>
          {(['create', 'login'] as const).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.tab, mode === m && { backgroundColor: colors.accent }]}>
              <Text style={[styles.tabText, mode === m && { color: colors.onAccent }]}>{m === 'create' ? 'New account' : 'I have an account'}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[s.card, { gap: 12 }]}>
          <Field label="Username">
            <TextInput
              value={username}
              onChangeText={(t) => setUsername(t.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))}
              placeholder="e.g. rafha"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              style={styles.input}
              placeholderTextColor={colors.muted}
            />
          </Field>
          <Field label="Password">
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={mode === 'create' ? 'At least 6 characters' : 'Your password'}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
              placeholderTextColor={colors.muted}
              onSubmitEditing={mode === 'login' && ready ? submit : undefined}
            />
          </Field>
          {mode === 'create' ? (
            <Field label="Your name">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Shown to your friends"
                style={styles.input}
                maxLength={30}
                placeholderTextColor={colors.muted}
              />
            </Field>
          ) : null}
          {code ? <Text style={s.muted}>You’ll join group <Text style={{ fontWeight: '800' }}>{code}</Text> too.</Text> : null}
          <Pressable
            onPress={submit}
            disabled={busy || !ready}
            style={({ pressed }) => [styles.btn, (busy || !ready) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Ionicons name={mode === 'create' ? 'person-add' : 'log-in'} size={20} color={colors.onAccent} />}
            <Text style={styles.btnText}>{mode === 'create' ? 'Create account' : 'Log in'}</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => updateSettings({ unlocked: false })} hitSlop={10}>
          <Text style={[s.muted, { textAlign: 'center', textDecorationLine: 'underline' }]}>Use another server</Text>
        </Pressable>
        {__DEV__ ? (
          <Pressable onPress={() => updateSettings({ devSkip: true })} hitSlop={10}>
            <Text style={[s.muted, { textAlign: 'center', textDecorationLine: 'underline' }]}>Skip (development build only)</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { s } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 24, gap: 16, paddingTop: 72, paddingBottom: 40 },
    logo: { alignSelf: 'center', width: 76, height: 76, borderRadius: 38, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    input: { fontSize: 17, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.faint, paddingVertical: 8 },
    paste: {
      flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 12,
      borderRadius: 12, borderWidth: 1.5, borderColor: colors.accent, borderStyle: 'dashed',
    },
    pasteText: { color: colors.accent, fontWeight: '700', fontSize: 15 },
    btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 14, minHeight: 54 },
    btnText: { color: colors.onAccent, fontWeight: '800', fontSize: 17 },
    tabs: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 3 },
    tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
    tabText: { fontWeight: '700', color: colors.text },
  });
