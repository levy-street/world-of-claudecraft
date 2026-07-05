import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.worldofclaudecraft',
  appName: 'World of ClaudeCraft',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    LiveUpdates: {
      appId: '9fa1b0c1',
      channel: 'Production',
      autoUpdateMethod: 'background',
      maxVersions: 2,
    },
  },
  server: {
    androidScheme: 'http',
  },
  ios: {
    contentInset: 'never',
  },
};

export default config;
