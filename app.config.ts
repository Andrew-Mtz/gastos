import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Gastos',
  slug: 'gastos',
  version: '0.1.0',
  scheme: 'gastos',
  platforms: ['ios', 'android'],
  plugins: ['expo-router', 'expo-status-bar'],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
