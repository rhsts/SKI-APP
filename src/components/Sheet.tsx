import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion, radius, space, target, useStyles, useTheme, type Palette } from '../theme';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Fill most of the screen (search, maps) instead of hugging the content. */
  tall?: boolean;
  children: React.ReactNode;
}

/**
 * More detail without changing the page underneath: a panel that rises from the bottom
 * over a dimmed screen. Closes with its button, a tap outside, or the back button.
 */
export function Sheet({ visible, title, onClose, tall, children }: Props) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <Animated.View
          entering={SlideInDown.springify().damping(motion.spring.damping).stiffness(motion.spring.stiffness).mass(motion.spring.mass)}
          style={[styles.panel, tall && styles.tall, { paddingBottom: Math.max(insets.bottom, space.lg) }]}
        >
          <View style={styles.grab} />
          <View style={styles.head}>
            <Text style={[s.h1, styles.grow]} numberOfLines={1} accessibilityRole="header">{title}</Text>
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close-outline" size={24} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={tall ? styles.grow : styles.hug} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    fill: { flex: 1, justifyContent: 'flex-end' },
    scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15,14,13,0.4)' },
    panel: {
      maxHeight: '88%', backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card,
      paddingHorizontal: space.xl, paddingTop: space.md,
    },
    tall: { height: '88%' },
    grab: { alignSelf: 'center', width: space.xxl, height: 4, borderRadius: 2, backgroundColor: colors.faint, marginBottom: space.sm },
    head: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: target.min },
    close: { width: target.min, height: target.min, alignItems: 'flex-end', justifyContent: 'center' },
    grow: { flex: 1 },
    hug: { flexGrow: 0 },
    body: { gap: space.lg, paddingTop: space.sm, paddingBottom: space.lg },
  });
