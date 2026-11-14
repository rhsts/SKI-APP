import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { motion } from '../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const easeOut = Easing.bezier(...motion.easeOut);

/** A Pressable that sinks slightly under your finger and comes back when you let go. No squash, no bounce. */
export function Tap({ style, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const down = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.02 * down.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, sink]}
      onPressIn={(e) => {
        down.value = withTiming(1, { duration: motion.press, easing: easeOut });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        down.value = withTiming(0, { duration: motion.micro, easing: easeOut });
        onPressOut?.(e);
      }}
    />
  );
}
