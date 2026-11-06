import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../friends/api';
import { syncFriends } from '../../friends/sync';
import { cleanCode } from '../../lib/groups';
import { useSettings } from '../../settings';
import { useStyles, useTheme, type Palette } from '../../theme';

/** Start a friend group for your trip, or join one with the code a friend sent you. */
export default function NewGroupScreen() {
  const { colors, s } = useTheme();
  const headerHeight = useHeaderHeight();
  const styles = useStyles(makeStyles);
  const { serverUrl } = useSettings();
  const params = useLocalSearchParams<{ code?: string }>();
  const [name, setName] = useState('');
  const [code, setCode] = useState(cleanCode(params.code ?? ''));
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  const go = async (kind: 'create' | 'join') => {
    setBusy(kind);
    try {
      const g = kind === 'create' ? await api.createGroup(name.trim()) : await api.joinGroup(code);
      await syncFriends().catch(() => undefined);
      router.replace(`/group/${g.id}`);
    } catch (e) {
      Alert.alert(kind === 'create' ? 'Couldn’t make the group' : 'Couldn’t join', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!serverUrl) {
    return (
      <View style={[s.screen, styles.content]}>
        <View style={[s.card, { gap: 8, alignItems: 'center' }]}>
          <Ionicons name="server-outline" size={36} color={colors.accent} />
          <Text style={s.h2}>Set up your friends server first</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Groups live on a small server (for example a Raspberry Pi). Enter its address under Profile → Friends server.
          </Text>
          <Pressable onPress={() => router.navigate('/profile')}>
            <Text style={styles.link}>Open Profile</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    // Edge-to-edge Android doesn't resize the window for the keyboard, so pad for it on both platforms.
    <KeyboardAvoidingView style={s.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <ScrollView style={s.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[s.card, { gap: 10 }]}>
          <Text style={s.h2}>Join a group</Text>
          <Text style={s.muted}>Type the 6-letter code a friend sent you.</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(cleanCode(t))}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, styles.code]}
            placeholderTextColor={colors.muted}
            maxLength={8}
          />
          <Btn label="Join" icon="enter-outline" disabled={code.length !== 6} busy={busy === 'join'} onPress={() => go('join')} />
        </View>

        <Text style={[s.muted, { textAlign: 'center' }]}>or</Text>

        <View style={[s.card, { gap: 10 }]}>
          <Text style={s.h2}>Start a new group</Text>
          <Text style={s.muted}>One group per trip works well, e.g. “Ischgl 2026”. You get a code to send to your friends.</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Group name" placeholderTextColor={colors.muted} style={styles.input} maxLength={40} />
          <Btn label="Create group" icon="people-outline" disabled={!name.trim()} busy={busy === 'create'} onPress={() => go('create')} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Btn({ label, icon, onPress, disabled, busy }: {
  label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; disabled?: boolean; busy?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [styles.btn, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator color={colors.onAccent} /> : <Ionicons name={icon} size={20} color={colors.onAccent} />}
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    content: { padding: 16, gap: 12 },
    input: { fontSize: 17, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.faint, paddingVertical: 8 },
    code: { fontSize: 28, fontWeight: '900', letterSpacing: 6, textAlign: 'center' },
    btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 14, minHeight: 52 },
    btnText: { color: colors.onAccent, fontWeight: '800', fontSize: 17 },
    link: { color: colors.accent, fontWeight: '800', fontSize: 15 },
  });
