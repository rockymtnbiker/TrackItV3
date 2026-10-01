import { createNativeStackNavigator } from '@react-navigation/native-stack';
import GoalsListScreen from '../screens/GoalsListScreen';
import StepDetailScreen from '../screens/StepDetailScreen';

export type GoalsStackParamList = {
  GoalsList: undefined;
  StepDetail: { goalId: string };
};

export type TodayStackParamList = {
  TodayMain: undefined;
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
        name="StepDetail"
        component={StepDetailScreen}
        options={{ title: 'Step' }}
      />
    </Stack.Navigator>
  );
}
