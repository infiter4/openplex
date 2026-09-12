import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.openplex',
  appName: 'openplex',
  webDir: 'dist',
  backgroundColor: '#0b0c0f',
  android: {
    backgroundColor: '#0b0c0f',
    // allow http to a LAN model server (e.g. Ollama on your PC) from the device
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      backgroundColor: '#0b0c0f',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      // actual style/color is set at runtime from the theme (see src/lib/native.ts)
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'native',
    },
  },
}

export default config
