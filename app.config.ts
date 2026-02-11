import { ExpoConfig, ConfigContext } from 'expo/config';

const IS_DEV = process.env.APP_VARIANT === 'development';
const IS_PREVIEW = process.env.APP_VARIANT === 'preview';

const getBundleId = () => {
  if (IS_DEV) return 'com.globalpay.app.dev';
  if (IS_PREVIEW) return 'com.globalpay.app.preview';
  return 'com.globalpay.app';
};

const getAppName = () => {
  if (IS_DEV) return 'GlobalPay (Dev)';
  if (IS_PREVIEW) return 'GlobalPay (Preview)';
  return 'GlobalPay';
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: getAppName(),
  slug: 'globalpay',
  version: '1.0.0',
  runtimeVersion: {
    policy: 'appVersion',
  },
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'globalpay',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: getBundleId(),
    buildNumber: '1',
    associatedDomains: ['applinks:globalpay.app', 'applinks:*.globalpay.app'],
    infoPlist: {
      NSCameraUsageDescription: 'GlobalPay needs camera access to scan QR codes for payments.',
      NSFaceIDUsageDescription: 'GlobalPay uses Face ID to secure your wallet.',
    },
  },
  android: {
    package: getBundleId(),
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#1A1A2E',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'globalpay.app', pathPrefix: '/pay' },
          { scheme: 'https', host: 'globalpay.app', pathPrefix: '/request' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
      {
        action: 'VIEW',
        data: [
          { scheme: 'globalpay', host: 'pay' },
          { scheme: 'globalpay', host: 'request' },
          { scheme: 'globalpay', host: 'send' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    permissions: [
      'android.permission.CAMERA',
      'android.permission.INTERNET',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
    ],
  },
  web: {
    output: 'static' as const,
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#1A1A2E',
        dark: {
          backgroundColor: '#1A1A2E',
        },
      },
    ],
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission: 'GlobalPay needs camera access to scan QR codes for payments.',
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'GlobalPay uses Face ID to secure your wallet.',
      },
    ],
    [
      '@sentry/react-native/expo',
      {
        organization: 'YOUR_SENTRY_ORG',
        project: 'globalpay',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: 'YOUR_EAS_PROJECT_ID',
    },
  },
  owner: 'YOUR_EXPO_USERNAME',
});
