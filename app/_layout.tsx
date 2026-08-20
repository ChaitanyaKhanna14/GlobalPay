/**
 * Root Layout - Wraps the entire app with AuthProvider
 * Handles auth-based routing (unauthenticated → login, authenticated → tabs)
 * Includes deep link handling for password reset and OAuth callbacks
 */

// ── Polyfills MUST come first ──
import '@/polyfills';

import * as Sentry from '@sentry/react-native';
import { useEffect, useState } from 'react';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Slot, Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import 'react-native-reanimated';
import { hasCompletedOnboarding, isOnboardingCompletedSync } from './onboarding';

import { AuthProvider, useAuth } from '@/context/auth-context';
import { AppLockProvider, useAppLock } from '@/context/app-lock-context';
import { LockScreen } from '@/components/lock-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { NetworkProvider } from '@/context/network-context';
import { GP } from '@/constants/colors';

// ── Sentry initialization ──
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
const isSentryConfigured = sentryDsn.startsWith('https://') && sentryDsn.includes('.ingest.sentry.io');

if (isSentryConfigured) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    enabled: !__DEV__,
    debug: false,
  });
} else if (!__DEV__) {
  console.warn('[Sentry] DSN not configured — crash reporting disabled');
}

// Always-dark custom theme matching our GP palette
const GPDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: GP.primary,
    background: GP.background,
    card: GP.surface,
    text: GP.textPrimary,
    border: GP.border,
    notification: GP.cardCoral,
  },
};

function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  // Check onboarding status once
  useEffect(() => {
    hasCompletedOnboarding().then(setOnboardingDone);
  }, []);

  // Handle deep links
  useEffect(() => {
    const handleDeepLink = ({ url }: { url: string }) => {
      __DEV__ && console.log('[DeepLink] Received:', url);
      
      const parsed = Linking.parse(url);
      
      // Handle password reset deep link
      if (parsed.path === 'reset-password' || parsed.hostname === 'reset-password') {
        router.push('/(auth)/reset-password' as any);
      }
      
      // Handle auth callback (OAuth)
      if (parsed.path?.includes('auth/callback') || parsed.hostname === 'auth') {
        // OAuth callback is handled by expo-auth-session
        __DEV__ && console.log('[DeepLink] OAuth callback received');
      }
    };

    // Listen for incoming links
    const subscription = Linking.addEventListener('url', handleDeepLink);

    // Check if app was opened with a link
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink({ url });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    if (isLoading || onboardingDone === null) return;
    if (!navigationState?.key) return;

    const inAuthGroup = (segments[0] as string) === '(auth)';
    const onOnboarding = (segments[0] as string) === 'onboarding';
    // Consult the synchronous cache too — state lags a tick behind the user
    // tapping "Skip"/"Get Started", and without this the redirect below fires
    // on that stale value and bounces them back into onboarding.
    const finishedOnboarding = onboardingDone || isOnboardingCompletedSync();

    __DEV__ && console.log('[Nav] Auth check:', { isAuthenticated, inAuthGroup, finishedOnboarding, segment: segments[0] });

    // If onboarding not done, send to onboarding (unless already there)
    if (!finishedOnboarding && !onOnboarding) {
      requestAnimationFrame(() => router.replace('/onboarding' as any));
      return;
    }

    // The SOC console is reachable without a session in development builds only,
    // so the security layer can be demonstrated and tested independently of the
    // payment app's auth state. __DEV__ is false in any release build, so the
    // guard below still applies in production — this is not a shipped bypass.
    const socDevAccess = __DEV__ && (segments[0] as string) === 'soc';

    if (!isAuthenticated && !inAuthGroup && finishedOnboarding && !socDevAccess) {
      requestAnimationFrame(() => router.replace('/(auth)' as any));
    } else if (isAuthenticated && inAuthGroup) {
      __DEV__ && console.log('[Nav] Navigating to tabs...');
      requestAnimationFrame(() => router.replace('/(tabs)' as any));
    }
  }, [isAuthenticated, isLoading, onboardingDone, navigationState?.key, segments]);

  if (isLoading) {
    return (
      <View style={loadingStyles.container}>
        <Text style={loadingStyles.logo}>⚡</Text>
        <Text style={loadingStyles.title}>GlobalPay</Text>
        <ActivityIndicator size="large" color={GP.primary} style={{ marginTop: 24 }} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: GP.background },
        headerStyle: { backgroundColor: GP.surface },
        headerTintColor: GP.textPrimary,
        headerTitleStyle: { fontWeight: '700', color: GP.textPrimary },
      }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="send" options={{ presentation: 'card', headerShown: true, title: 'Send Money' }} />
      <Stack.Screen name="receive" options={{ presentation: 'card', headerShown: true, title: 'Receive' }} />
      <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', headerShown: false }} />
      <Stack.Screen name="request" options={{ presentation: 'card', headerShown: true, title: 'Request Money' }} />
      <Stack.Screen name="linked-accounts" options={{ presentation: 'card', headerShown: true, title: 'Linked Accounts' }} />
      <Stack.Screen name="soc/index" options={{ presentation: 'card', headerShown: false }} />
      <Stack.Screen name="soc/integrity" options={{ presentation: 'card', headerShown: false }} />
      <Stack.Screen name="soc/mitre" options={{ presentation: 'card', headerShown: false }} />
      <Stack.Screen name="soc/[alertId]" options={{ presentation: 'card', headerShown: false }} />
      <Stack.Screen name="privacy-policy" options={{ presentation: 'card', headerShown: false }} />
      <Stack.Screen name="terms-of-service" options={{ presentation: 'card', headerShown: false }} />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: GP.background,
  },
  logo: { fontSize: 56, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: GP.primary },
});

function AppLockGate({ children }: { children: React.ReactNode }) {
  const { isLocked, isLockEnabled } = useAppLock();

  if (isLocked && isLockEnabled) {
    return <LockScreen />;
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <NetworkProvider>
        <AuthProvider>
          <AppLockProvider>
            <ThemeProvider value={GPDarkTheme}>
              <AppLockGate>
                <RootNavigator />
              </AppLockGate>
              <StatusBar style="light" backgroundColor={GP.background} translucent={false} />
            </ThemeProvider>
          </AppLockProvider>
        </AuthProvider>
      </NetworkProvider>
    </ErrorBoundary>
  );
}
