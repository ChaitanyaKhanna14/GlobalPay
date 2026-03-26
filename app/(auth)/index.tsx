/**
 * Auth Selection Screen - Entry point for authentication
 * Offers social login, phone, and email options
 */
import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/auth-context';
import { GP } from '@/constants/colors';

export default function AuthSelectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signInWithGoogle, signInWithApple } = useAuth();
  
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);

  const handleGoogleSignIn = async () => {
    setLoadingGoogle(true);
    try {
      const result = await signInWithGoogle();
      
      if (result.needsUsername && result.tempUserId) {
        // New user - needs to complete signup with username
        router.push({
          pathname: '/(auth)/complete-signup',
          params: { tempUserId: result.tempUserId, email: result.email ?? '' },
        } as any);
      } else if (result.error) {
        Alert.alert('Sign In Failed', result.error.message);
      }
      // If success and no needsUsername, auth context will handle navigation
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoadingGoogle(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoadingApple(true);
    try {
      const result = await signInWithApple();
      
      if (result.needsUsername && result.tempUserId) {
        router.push({
          pathname: '/(auth)/complete-signup',
          params: { tempUserId: result.tempUserId, email: result.email ?? '' },
        } as any);
      } else if (result.error) {
        Alert.alert('Sign In Failed', result.error.message);
      }
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoadingApple(false);
    }
  };

  const handlePhoneAuth = () => {
    router.push('/(auth)/phone-auth' as any);
  };

  const handleEmailLogin = () => {
    router.push('/(auth)/login' as any);
  };

  const handleEmailSignup = () => {
    router.push('/(auth)/signup' as any);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}>
      {/* Logo */}
      <View style={styles.logoContainer}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoIcon}>⚡</Text>
        </View>
        <Text style={styles.logoText}>GlobalPay</Text>
        <Text style={styles.tagline}>Instant global payments</Text>
      </View>

      {/* Auth Options */}
      <View style={styles.authOptions}>
        {/* Google */}
        <TouchableOpacity
          style={styles.socialButton}
          onPress={handleGoogleSignIn}
          disabled={loadingGoogle || loadingApple}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google">
          {loadingGoogle ? (
            <ActivityIndicator size="small" color={GP.textPrimary} />
          ) : (
            <>
              <Ionicons name="logo-google" size={22} color={GP.textPrimary} style={styles.socialIcon} />
              <Text style={styles.socialButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Apple (iOS only) */}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={styles.socialButton}
            onPress={handleAppleSignIn}
            disabled={loadingGoogle || loadingApple}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple">
            {loadingApple ? (
              <ActivityIndicator size="small" color={GP.textPrimary} />
            ) : (
              <>
                <Ionicons name="logo-apple" size={24} color={GP.textPrimary} style={styles.socialIcon} />
                <Text style={styles.socialButtonText}>Continue with Apple</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Phone */}
        <TouchableOpacity
          style={styles.socialButton}
          onPress={handlePhoneAuth}
          disabled={loadingGoogle || loadingApple}
          accessibilityRole="button"
          accessibilityLabel="Continue with Phone">
          <Ionicons name="phone-portrait-outline" size={22} color={GP.textPrimary} style={styles.socialIcon} />
          <Text style={styles.socialButtonText}>Continue with Phone</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Email Login */}
        <TouchableOpacity
          style={styles.emailButton}
          onPress={handleEmailLogin}
          disabled={loadingGoogle || loadingApple}
          accessibilityRole="button"
          accessibilityLabel="Sign in with Email">
          <Ionicons name="mail-outline" size={22} color={GP.textOnYellow} style={styles.socialIcon} />
          <Text style={styles.emailButtonText}>Sign in with Email</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Don't have an account? </Text>
        <TouchableOpacity onPress={handleEmailSignup} accessibilityRole="link">
          <Text style={styles.footerLink}>Sign Up</Text>
        </TouchableOpacity>
      </View>

      {/* Terms */}
      <Text style={styles.termsText}>
        By continuing, you agree to our{' '}
        <Text style={styles.termsLink} onPress={() => router.push('/terms-of-service' as any)}>
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text style={styles.termsLink} onPress={() => router.push('/privacy-policy' as any)}>
          Privacy Policy
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
    paddingHorizontal: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
    flex: 1,
    justifyContent: 'center',
  },
  logoBadge: {
    width: 100,
    height: 100,
    borderRadius: 28,
    backgroundColor: GP.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  logoIcon: {
    fontSize: 50,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '800',
    color: GP.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 16,
    color: GP.textSecondary,
    marginTop: 8,
  },
  authOptions: {
    gap: 14,
    marginBottom: 32,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GP.surface,
    borderWidth: 1.5,
    borderColor: GP.border,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    minHeight: 56,
  },
  socialIcon: {
    marginRight: 12,
  },
  socialButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: GP.textPrimary,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: GP.border,
  },
  dividerText: {
    color: GP.textMuted,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    minHeight: 56,
  },
  emailButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: GP.textOnYellow,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  footerText: {
    color: GP.textSecondary,
    fontSize: 15,
  },
  footerLink: {
    color: GP.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  termsText: {
    color: GP.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    color: GP.textSecondary,
    textDecorationLine: 'underline',
  },
});
