import { createNativeStackNavigator } from '@react-navigation/native-stack';
import GoalDetailScreen from '../screens/GoalDetailScreen';
import GoalsListScreen from '../screens/GoalsListScreen';
import HabitDetailScreen from '../screens/HabitDetailScreen';
import MilestoneDetailScreen from '../screens/MilestoneDetailScreen';

/** Shared by Goals and Today stacks so detail screens can open from either tab. */
export type DetailStackParamList = {
  GoalDetail: { goalId: string };
  MilestoneDetail: { milestoneId: string };
  HabitDetail: { habitId: string };
};

export type GoalsStackParamList = {
  GoalsList: undefined;
} & DetailStackParamList;

export type TodayStackParamList = {
  TodayMain: undefined;
} & DetailStackParamList;

const Stack = createNativeStackNavigator<GoalsStackParamList>();

export default function GoalsStackNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="GoalsList"
        component={GoalsListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GoalDetail"
        component={GoalDetailScreen}
        options={{ title: 'Goal' }}
      />
      <Stack.Screen
        name="MilestoneDetail"
        component={MilestoneDetailScreen}
        options={{ title: 'Milestone' }}
      />
      <Stack.Screen
        name="HabitDetail"
        component={HabitDetailScreen}
        options={{ title: 'Habit' }}
      />
    </Stack.Navigator>
  );
}
