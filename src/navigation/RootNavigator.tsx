import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import AuthStackNavigator from './AuthStackNavigator';
import TabNavigator from './TabNavigator';

export default function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#007aff" />
      </View>
    );
  }

  if (!session) {
    return <AuthStackNavigator />;
  }

  return <TabNavigator />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f2f7',
  },
});
