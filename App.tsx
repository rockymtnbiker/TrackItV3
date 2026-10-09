import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AuthProvider>
          <NavigationContainer>
            <RootNavigator />
            <StatusBar style="auto" />
          </NavigationContainer>
        </AuthProvider>
        <DevBadge />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function DevBadge() {
  if (!__DEV__) {
    return null;
  }
  return <DevBadgeMarker />;
}

function DevBadgeMarker() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={[styles.devBadge, { top: insets.top, right: Math.max(insets.right, 8) }]}
    >
      <Text style={styles.devBadgeText}>DEV</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  devBadge: {
    position: 'absolute',
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: 'orange',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  devBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
  },
});
