import { useEffect } from 'react';
import { Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { motion } from '../theme';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const easeOut = Easing.bezier(...motion.easeOut);

/**
 * A number whose digits roll to their new value instead of jumping, like a counter wheel.
 * Anything that isn't a digit (".", ",", ":") is drawn as it is. `style` needs tabular
 * figures so every digit is the same width, and `height` is the height of one line.
 * With "Reduce motion" on, Reanimated skips the roll and the digit just changes.
 * The digits ignore the phone's text-size setting: each sits in a fixed-height window.
 */
export function RollingNumber({ value, style, height }: { value: string; style: StyleProp<TextStyle>; height: number }) {
  const chars = value.split('');
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'baseline' }}
      accessible
      accessibilityLabel={value}
    >
      {chars.map((c, i) => {
        // Keyed from the right, so 9 → 10 keeps the ones column and adds a tens column.
        const key = chars.length - i;
        return c >= '0' && c <= '9'
          ? <Digit key={key} digit={Number(c)} style={style} height={height} />
          : <Text key={key} allowFontScaling={false} style={[style, { lineHeight: height }]}>{c}</Text>;
      })}
    </View>
  );
}

function Digit({ digit, style, height }: { digit: number; style: StyleProp<TextStyle>; height: number }) {
  const y = useSharedValue(-digit * height);
  useEffect(() => {
    y.value = withTiming(-digit * height, { duration: motion.roll, easing: easeOut });
  }, [digit, height, y]);
  const roll = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height, overflow: 'hidden' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={roll}>
        {DIGITS.map((n) => <Text key={n} allowFontScaling={false} style={[style, { height, lineHeight: height }]}>{n}</Text>)}
      </Animated.View>
    </View>
  );
}
