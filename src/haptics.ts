import * as Haptics from 'expo-haptics';
import { getSettings } from './settings';

/** The one place that decides what the phone does for each moment. Never on scroll, never on every tap. */
const MAP = {
  /** Start and stop recording. */
  record: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  runDone: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  topSpeed: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  jump: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  /** Toggles and pickers. */
  select: () => Haptics.selectionAsync(),
  fall: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
} as const;

export function haptic(kind: keyof typeof MAP) {
  // A fall warning always buzzes: it's a safety check, not a gimmick.
  if (!getSettings().vibrate && kind !== 'fall') return;
  MAP[kind]().catch(() => undefined);
}
