import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.prakash.stint',
  appName: 'Stint',
  webDir: 'dist',
  android: {
    // The clock is bone on near-black; the default white splash flashes at launch.
    backgroundColor: '#0E1211',
  },
};

export default config;
