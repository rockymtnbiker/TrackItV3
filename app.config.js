module.exports = {
  expo: {
    name: process.env.APP_VARIANT === 'preview' ? 'TrackIt' : 'TrackIt Dev',
    slug: 'TrackItv3',
    owner: 'blue_sky_development',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      '@react-native-community/datetimepicker',
      'expo-status-bar',
      'expo-font',
    ],
    extra: {
      eas: {
        projectId: 'ead878c6-d7a0-4b4c-8610-f7df6fc3f146',
      },
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    updates: {
      url: 'https://u.expo.dev/ead878c6-d7a0-4b4c-8610-f7df6fc3f146',
    },
  },
};
