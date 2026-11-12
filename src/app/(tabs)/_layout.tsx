import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router/tabs';
import { useTheme } from '../../theme';
import { useTracker } from '../../tracking/tracker';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

export default function TabsLayout() {
  const { colors } = useTheme();
  const { status } = useTracker();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.faint },
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '800', color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Record',
          tabBarIcon: icon(status === 'recording' ? 'radio-button-on' : 'radio-button-off'),
          tabBarBadge: status === 'recording' ? '●' : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: '#fff', fontSize: 8 },
        }}
      />
      <Tabs.Screen name="days" options={{ title: 'Days', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="challenges" options={{ title: 'Challenges', tabBarIcon: icon('flag-outline') }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Friends', tabBarIcon: icon('podium-outline') }} />
      <Tabs.Screen name="season"options={{ title: 'Season', tabBarIcon: icon('trophy-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
