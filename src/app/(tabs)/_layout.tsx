import { Tabs } from 'expo-router/tabs';
import { TabBar } from '../../components/TabBar';
import { font, size, useTheme } from '../../theme';

/**
 * Four tabs: Record, Days, Friends, You. Challenges and Season are still routes
 * here, but they are opened from Friends and You instead of having a tab button.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: font.medium, fontSize: size.body, color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Record', headerShown: false }} />
      <Tabs.Screen name="days" options={{ title: 'Days' }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Friends' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
      <Tabs.Screen name="challenges" options={{ title: 'Challenges' }} />
      <Tabs.Screen name="season" options={{ title: 'Season' }} />
    </Tabs>
  );
}
