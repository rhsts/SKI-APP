import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { closeDialog, useDialog, type DialogButton } from '../dialog';
import { motion, radius, space, useStyles, useTheme, type Palette } from '../theme';
import { Tap } from './Tap';

/**
 * Draws whatever `dialog()` asks, once, at the root: a panel that rises from the bottom
 * like every other sheet. The answer that does something is solid; "Cancel" is plain text.
 */
export function DialogHost() {
  const d = useDialog();
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  if (!d) return null;

  const cancel = d.buttons.find((b) => b.style === 'cancel');
  const actions = d.buttons.filter((b) => b !== cancel);
  const pick = (b?: DialogButton) => {
    closeDialog();
    // On the next tick, so the panel is gone before an answer that starts slow work (saving a day) runs.
    if (b?.onPress) setTimeout(b.onPress, 0);
  };

  const body = (
    <View style={styles.fill} accessibilityViewIsModal>
      <Animated.View entering={FadeIn.duration(motion.enter)} style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => pick(cancel)} accessibilityRole="button" accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        key={d.id}
        entering={SlideInDown.springify().damping(motion.spring.damping).stiffness(motion.spring.stiffness).mass(motion.spring.mass)}
        style={[styles.panel, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }]}
      >
        <View style={styles.grab} />
        <Text style={s.h1} accessibilityRole="header">{d.title}</Text>
        {d.message ? <Text style={[s.body, { color: colors.muted }]}>{d.message}</Text> : null}
        <View style={styles.buttons}>
          {actions.map((b) => {
            // One answer: it is the point of the dialog, so it is solid. Several: a quiet list to pick from.
            const solid = actions.length === 1;
            return (
              <Tap key={b.text} onPress={() => pick(b)} style={[styles.button, solid && styles.solid]} accessibilityRole="button" accessibilityLabel={b.text}>
                <Text style={[s.control, solid ? { color: colors.bg } : b.style === 'destructive' && { color: colors.danger }]}>{b.text}</Text>
              </Tap>
            );
          })}
          {cancel ? (
            <Pressable onPress={() => pick(cancel)} style={styles.plain} accessibilityRole="button" accessibilityLabel={cancel.text}>
              <Text style={[s.control, { color: colors.muted }]}>{cancel.text}</Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );

  // A Modal on iOS can't open while another one (a sheet, the SOS screen) is up; the overlay sits above them all.
  return Platform.OS === 'ios' ? (
    <FullWindowOverlay>{body}</FullWindowOverlay>
  ) : (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => pick(cancel)}>
      {body}
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    fill: { flex: 1, justifyContent: 'flex-end' },
    scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15,14,13,0.4)' },
    panel: {
      backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card,
      paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm,
    },
    grab: { alignSelf: 'center', width: space.xxl, height: 4, borderRadius: 2, backgroundColor: colors.faint, marginBottom: space.sm },
    buttons: { gap: space.sm, marginTop: space.md },
    button: { minHeight: 56, borderRadius: radius.card, backgroundColor: colors.faint, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
    solid: { backgroundColor: colors.text },
    plain: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  });
