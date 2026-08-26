import { Ionicons } from '@expo/vector-icons';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../screens/DashboardScreen';
import GoalDetailScreen from '../screens/GoalDetailScreen';
import HabitDetailScreen from '../screens/HabitDetailScreen';
import MilestoneDetailScreen from '../screens/MilestoneDetailScreen';
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

const Tab = createMaterialTopTabNavigator<RootTabParamList>();
const TodayStack = createNativeStackNavigator<TodayStackParamList>();
const DashboardStack = createNativeStackNavigator();

/** Keeps the same stack header chrome bottom tabs previously provided. */
function TodayStackNavigator() {
  return (
    <TodayStack.Navigator>
      <TodayStack.Screen
        name="TodayMain"
        component={TodayScreen}
        options={{ title: 'Today' }}
      />
      <TodayStack.Screen
        name="HabitDetail"
        component={HabitDetailScreen}
        options={{ title: 'Habit' }}
      />
      <TodayStack.Screen
        name="MilestoneDetail"
        component={MilestoneDetailScreen}
        options={{ title: 'Milestone' }}
      />
      <TodayStack.Screen
        name="GoalDetail"
        component={GoalDetailScreen}
        options={{ title: 'Goal' }}
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
        options={{ title: 'Dashboard' }}
      />
    </DashboardStack.Navigator>
  );
}

export default function TabNavigator() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = 49 + insets.bottom;

  return (
    <Tab.Navigator
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
        tabBarIconStyle: {
          marginTop: 2,
        },
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayStackNavigator}
        options={{
          tabBarLabel: 'Today',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'calendar' : 'calendar-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Goals"
        component={GoalsStackNavigator}
        options={{
          tabBarLabel: 'Goals',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'flag' : 'flag-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Dashboard"
        component={DashboardStackNavigator}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'stats-chart' : 'stats-chart-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
