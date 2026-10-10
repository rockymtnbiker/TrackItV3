import { createNativeStackNavigator } from '@react-navigation/native-stack';
import GoalScreen from '../screens/GoalScreen';
import GoalsListScreen from '../screens/GoalsListScreen';
import StepDetailScreen from '../screens/StepDetailScreen';

export type GoalsStackParamList = {
  GoalsList: undefined;
  Goal: { goalId: string };
  StepDetail: { goalId: string };
};

export type TodayStackParamList = {
  TodayMain: undefined;
  Goal: { goalId: string };
  StepDetail: { goalId: string };
};

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
        name="Goal"
        component={GoalScreen}
        options={{ title: '', headerTitleAlign: 'center' }}
      />
      <Stack.Screen
        name="StepDetail"
        component={StepDetailScreen}
        options={{ title: 'Edit goal', headerTitleAlign: 'center' }}
      />
    </Stack.Navigator>
  );
}
