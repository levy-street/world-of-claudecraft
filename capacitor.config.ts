import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.worldofclaudecraft',
  appName: 'World of ClaudeCraft',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
  },
  ios: {
    contentInset: 'never',
  },
  plugins: {
    // Self-hosted OTA updates (docs/ota-updates.md). The plugin checks our own
    // server, which points it at the S3-hosted bundle zip; nothing talks to
    // the Capgo cloud (updateUrl overridden, statsUrl '' disables telemetry).
    // Rollback safety: src/net/native_ota.ts must confirm each applied bundle
    // via notifyAppReady, or the plugin reverts it on the next launch.
    CapacitorUpdater: {
      autoUpdate: true,
      updateUrl: 'https://worldofclaudecraft.com/api/ota/updates',
      statsUrl: '',
    },
  },
};

export default config;
