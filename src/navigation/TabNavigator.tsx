import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../screens/DashboardScreen';
import StepDetailScreen from '../screens/StepDetailScreen';
import TodayScreen from '../screens/TodayScreen';
import GoalsStackNavigator, {
  type TodayStackParamList,
} from './GoalsStackNavigator';

export type RootTabParamList = {
  Today: undefined;
  Goals: undefined;
  Dashboard: undefined;
};

export type { TodayStackParamList };

export type DashboardStackParamList = {
  DashboardMain: undefined;
  StepDetail: { goalId: string };
};

const Tab = createMaterialTopTabNavigator<RootTabParamList>();
const TodayStack = createNativeStackNavigator<TodayStackParamList>();
const DashboardStack = createNativeStackNavigator<DashboardStackParamList>();

/** Keeps the same stack header chrome bottom tabs previously provided. */
function TodayStackNavigator() {
  return (
    <TodayStack.Navigator>
      <TodayStack.Screen
        name="TodayMain"
        component={TodayScreen}
        options={{ headerShown: false }}
      />
      <TodayStack.Screen
        name="StepDetail"
        component={StepDetailScreen}
        options={{ title: 'Step' }}
      />
    </TodayStack.Navigator>
  );
}

function DashboardStackNavigator() {
  return (
    <DashboardStack.Navigator>
      <DashboardStack.Screen
        name="DashboardMain"
        component={DashboardScreen}
        options={{ headerShown: false }}
      />
      <DashboardStack.Screen
        name="StepDetail"
        component={StepDetailScreen}
        options={{ title: 'Step' }}
      />
    </DashboardStack.Navigator>
  );
}

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 49 + insets.bottom;

  return (
    <Tab.Navigator
      initialRouteName="Today"
      tabBarPosition="bottom"
      screenOptions={{
        swipeEnabled: true,
        tabBarShowIcon: true,
        tabBarShowLabel: true,
        tabBarActiveTintColor: Platform.OS === 'ios' ? '#007AFF' : '#007aff',
        tabBarInactiveTintColor: Platform.OS === 'ios' ? '#8E8E93' : '#737373',
        tabBarPressColor: 'transparent',
        tabBarPressOpacity: 0.7,
        tabBarIndicatorStyle: {
          height: 0,
          width: 0,
        },
        tabBarStyle: {
          backgroundColor: Platform.OS === 'ios' ? '#F9F9F9' : '#ffffff',
          borderTopColor: Platform.OS === 'ios' ? '#A7A7AA' : '#e0e0e0',
          borderTopWidth: StyleSheet.hairlineWidth,
          height: tabBarHeight,
          paddingBottom: insets.bottom,
          elevation: 8,
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: -1 },
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
          textTransform: 'none',
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="Goals"
        component={GoalsStackNavigator}
        options={{
          tabBarLabel: 'Plan',
          tabBarIcon: ({ focused, color }) => (
            <MaterialCommunityIcons
              name={focused ? 'clipboard-edit' : 'clipboard-edit-outline'}
              size={24}
              color={color}
              style={styles.tabIcon}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Today"
        component={TodayStackNavigator}
        options={{
          tabBarLabel: 'Do',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'calendar' : 'calendar-outline'}
              size={24}
              color={color}
              style={styles.tabIcon}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Dashboard"
        component={DashboardStackNavigator}
        options={{
          tabBarLabel: 'Review',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'stats-chart' : 'stats-chart-outline'}
              size={24}
              color={color}
              style={styles.tabIcon}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    marginTop: 2,
  },
});
