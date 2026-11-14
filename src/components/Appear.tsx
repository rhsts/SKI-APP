import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOut } from 'react-native-reanimated';
import { motion, space } from '../theme';

const enter = FadeInDown.duration(motion.enter)
  .easing(Easing.bezier(...motion.easeOut))
  .withInitialValues({ opacity: 0, transform: [{ translateY: space.sm }] });
// Leaving is quicker than arriving: it should get out of your way.
const exit = FadeOut.duration(motion.exit);

/**
 * Something that comes and goes: fades in while rising a few points into place,
 * fades out when removed. Reanimated skips both when the phone has
 * "Reduce motion" on.
 */
export function Appear({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={enter} exiting={exit} style={style}>
      {children}
    </Animated.View>
  );
}
