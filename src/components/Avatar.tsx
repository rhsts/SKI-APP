import { Image, StyleSheet, Text, View } from 'react-native';
import { useAvatar } from '../friends/avatars';
import { useTheme } from '../theme';

const COLORS = ['#0B6BCB', '#E8892B', '#1F9D55', '#8E44AD', '#C0392B', '#16A085', '#D35400', '#2C3E50'];

/** A skier's profile picture, or their initials on a coloured circle. */
export function Avatar({ playerId, name, size = 36, hasAvatar = true }: {
  playerId: string | null | undefined; name: string; size?: number; hasAvatar?: boolean;
}) {
  const { colors } = useTheme();
  const uri = useAvatar(playerId, hasAvatar);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={[box, { backgroundColor: colors.faint }]} accessibilityLabel={`${name}’s picture`} />;
  const initials = name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  let h = 0;
  for (const c of playerId ?? name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <View style={[box, styles.circle, { backgroundColor: COLORS[h % COLORS.length] }]}>
      <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '800' },
});
