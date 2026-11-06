import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { badgeInfo } from '../lib/goals';
import { fmtDate } from '../lib/format';
import { useStyles, useTheme, type Palette } from '../theme';

export interface BadgeView {
  id: string;
  emoji: string;
  title: string;
  /** When it was earned (epoch ms), or null if not yet. */
  earnedAt: number | null;
}

/**
 * What a badge means: tap a badge to see how it's earned, when you got it,
 * and (for your own badges) open the day that earned it.
 */
export function BadgeSheet({ badge, onClose, onOpenDay, whose = 'you' }: {
  badge: BadgeView | null;
  onClose: () => void;
  /** Shown as "Open that day" when set (your own badges). */
  onOpenDay?: () => void;
  /** "you" for your own badges, or a friend's name. */
  whose?: string;
}) {
  const { colors, s } = useTheme();
  const styles = useStyles(makeStyles);
  const info = badge ? badgeInfo(badge.id) : null;
  const got = badge?.earnedAt != null;
  return (
    <Modal visible={!!badge} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        {badge ? (
          <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => undefined}>
            <View style={[styles.medal, { backgroundColor: got ? colors.warnSoft : colors.faint }]}>
              <Text style={[styles.emoji, !got && { opacity: 0.4 }]}>{badge.emoji}</Text>
              {!got ? <Text style={styles.lock}>🔒</Text> : null}
            </View>
            <Text style={[s.h1, { textAlign: 'center' }]}>{badge.title}</Text>
            <Text style={[s.body, { textAlign: 'center', fontWeight: '700' }]}>
              {info?.description ?? ''}
            </Text>
            {info?.tip ? <Text style={[s.muted, { textAlign: 'center' }]}>{info.tip}</Text> : null}
            <View style={[styles.status, { backgroundColor: got ? colors.accentSoft : colors.bg }]}>
              <Text style={[s.body, { textAlign: 'center' }]}>
                {got
                  ? `${whose === 'you' ? 'You' : whose} earned it on ${fmtDate(badge.earnedAt!)}.`
                  : whose === 'you' ? 'Not earned yet. Go get it!' : `${whose} hasn’t earned it yet.`}
              </Text>
            </View>
            {got && onOpenDay ? (
              <Pressable onPress={onOpenDay} style={[styles.btn, { backgroundColor: colors.accent }]} accessibilityRole="button">
                <Text style={[styles.btnText, { color: colors.onAccent }]}>Open that day</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Text style={[styles.close, { color: colors.accent }]}>Close</Text>
            </Pressable>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const makeStyles = (_: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
    sheet: { borderRadius: 20, padding: 24, gap: 12, alignItems: 'stretch' },
    medal: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
    emoji: { fontSize: 52 },
    lock: { position: 'absolute', right: 2, bottom: 2, fontSize: 22 },
    status: { borderRadius: 12, padding: 12 },
    btn: { borderRadius: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    btnText: { fontWeight: '800', fontSize: 16 },
    close: { textAlign: 'center', fontWeight: '800', fontSize: 16, paddingVertical: 4 },
  });
