import { Image, StyleSheet, Text, View } from 'react-native';
import { useAvatar } from '../friends/avatars';
import { font, useTheme } from '../theme';

// Mountain tones that sit beside glacier and graphite: lake, pine, slate, umber, larch, dusk, moss, rock.
// All dark enough for white initials (at least 4.5:1). Red stays with SOS, so none of them is red.
const COLORS = ['#2F5561', '#2E5E4E', '#4A5563', '#7A5236', '#7A6420', '#5E4A66', '#4F6B3A', '#54514B'];

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
  initials: { color: '#fff', fontFamily: font.medium },
});
