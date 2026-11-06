import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { api, type AdminPlayer } from '../friends/api';
import { fmtDate } from '../lib/format';
import { useSettings } from '../settings';
import { useStyles, useTheme, type Palette } from '../theme';

function ago(ms: number | null, now: number): string {
  if (!ms) return 'never';
  const m = Math.round((now - ms) / 60000);
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return fmtDate(ms);
}

/** For the server's admin: everyone on the server, and removing someone. */
export default function AdminScreen() {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const { playerId, account } = useSettings();
  const [people, setPeople] = useState<AdminPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api.adminPlayers().then(
        (list) => {
          setPeople(list);
          setNow(Date.now());
          setError(null);
        },
        (e) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [],
  );
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!account?.isAdmin) return <Text style={[s.body, { padding: 24 }]}>Only an admin can see this.</Text>;
  if (error && !people) return <Text style={[s.body, { padding: 24, color: colors.danger }]}>{error}</Text>;
  if (!people) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />;

  const remove = (p: AdminPlayer) =>
    Alert.alert(
      `Remove ${p.name}${p.username ? ` (@${p.username})` : ''}?`,
      'Their account, groups memberships, shared days, challenge times and online backup are deleted, and their phone can’t get back in. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => api.adminRemove(p.id).then(load).catch((e) => Alert.alert('Couldn’t remove', String(e?.message ?? e))),
        },
      ],
    );

  const toggleAdmin = (p: AdminPlayer) =>
    Alert.alert(p.isAdmin ? `Take admin away from ${p.name}?` : `Make ${p.name} an admin?`, 'Admins can see and remove everyone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'OK', onPress: () => api.adminSetAdmin(p.id, !p.isAdmin).then(load).catch((e) => Alert.alert('Couldn’t change', String(e?.message ?? e))) },
    ]);

  const accounts = people.filter((p) => p.username).length;
  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={styles.list}
      data={people}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} />}
      ListHeaderComponent={
        <Text style={s.muted}>
          {accounts} {accounts === 1 ? 'account' : 'accounts'}, {people.length - accounts} {people.length - accounts === 1 ? 'phone' : 'phones'} without
          one. To shut everyone else out at once, change the server password on the Pi.
        </Text>
      }
      renderItem={({ item: p }) => (
        <View style={[s.card, styles.row]}>
          <Pressable onPress={() => router.push(`/player/${p.id}`)}>
            <Avatar playerId={p.id} name={p.name} size={44} hasAvatar={p.hasAvatar} />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.h2} numberOfLines={1}>
              {p.name}{p.id === playerId ? ' (you)' : ''}{p.isAdmin ? ' 👑' : ''}
            </Text>
            <Text style={s.muted} numberOfLines={1}>{p.username ? `@${p.username}` : 'No account'} · seen {ago(p.lastSeen, now)}</Text>
            <Text style={s.muted} numberOfLines={1}>
              {p.groups} {p.groups === 1 ? 'group' : 'groups'} · {p.days} days · {p.phones} {p.phones === 1 ? 'phone' : 'phones'}
              {p.backups ? ` · backup ${(p.backupBytes / 1e6).toFixed(1)} MB` : ''}
            </Text>
          </View>
          {p.id !== playerId ? (
            <View style={{ gap: 10, alignItems: 'flex-end' }}>
              {p.username ? (
                <Pressable onPress={() => toggleAdmin(p)} hitSlop={8}>
                  <Text style={styles.link}>{p.isAdmin ? 'Unadmin' : 'Make admin'}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => remove(p)} hitSlop={8}>
                <Text style={[styles.link, { color: colors.danger }]}>Remove</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    />
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    list: { padding: 16, gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    link: { color: colors.accent, fontWeight: '700' },
  });
