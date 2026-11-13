import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A Pressable that sinks slightly under your finger and comes back when you let go. */
export function Tap({ style, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const down = useSharedValue(0);
  const sink = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.03 * down.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, sink]}
      onPressIn={(e) => {
        down.value = withTiming(1, { duration: 80 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        down.value = withTiming(0, { duration: 160 });
        onPressOut?.(e);
      }}
    />
  );
}
