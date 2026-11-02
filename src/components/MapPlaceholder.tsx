import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useStyles, useTheme, type Palette } from '../theme';

/** Shown instead of a map in builds without a Google Maps key (see README → Install the app). */
export function MapPlaceholder({ height = 260, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.wrap, { height }, style]}>
      <Ionicons name="map-outline" size={32} color={colors.muted} />
      <Text style={[s.body, { fontWeight: '700' }]}>Map not available in this build</Text>
      <Text style={[s.muted, { textAlign: 'center' }]}>
        The app was built without a Google Maps key. Everything else works; maps appear after the next build with the key.
      </Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { borderRadius: 16, backgroundColor: colors.faint, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20 },
  });
