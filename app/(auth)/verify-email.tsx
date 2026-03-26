/**
 * Verify Email Screen - Shows after signup, with resend functionality
 * Includes auto-check for verification status
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/supabase';
import { GP } from '@/constants/colors';

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyEmailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();
  const { resendVerificationEmail } = useAuth();
  const email = params.email || '';

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleCheckVerification = useCallback(async () => {
    if (!email) return;
    
    setChecking(true);
    try {
      // Just redirect to login - user will find out if they're verified when they try to sign in
      // This is simpler and avoids confusing OTP flows
      router.replace({
        pathname: '/(auth)/login',
        params: { email, fromVerification: 'true' }
      } as any);
    } finally {
      setChecking(false);
    }
  }, [email, router]);

  const handleResendVerification = async () => {
    if (!email) {
      Alert.alert('Error', 'No email address provided');
      return;
    }

    if (cooldown > 0) return;

    setLoading(true);
    const result = await resendVerificationEmail(email);
    setLoading(false);

    if (result.error) {
      Alert.alert('Error', result.error.message);
    } else {
      Alert.alert('Email Sent', 'Check your inbox for the verification link.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  };

  const handleBackToLogin = () => {
    router.replace('/(auth)/login' as any);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom }]}>
      {/* Back button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={GP.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.headerContainer}>
          <View style={styles.headerBadge}>
            <Ionicons name="mail-outline" size={44} color={GP.textOnYellow} />
          </View>
          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.subtitle}>
            We sent a verification link to
          </Text>
          {email ? (
            <Text style={styles.emailText}>{email}</Text>
          ) : (
            <Text style={styles.emailMissing}>your email address</Text>
          )}
        </View>

        {/* Instructions */}
        <View style={styles.instructionsContainer}>
          <View style={styles.instructionRow}>
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionNumber}>1</Text>
            </View>
            <Text style={styles.instructionText}>Check your email inbox</Text>
          </View>
          <View style={styles.instructionRow}>
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionNumber}>2</Text>
            </View>
            <Text style={styles.instructionText}>Click the verification link</Text>
          </View>
          <View style={styles.instructionRow}>
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionNumber}>3</Text>
            </View>
            <Text style={styles.instructionText}>Return here to sign in</Text>
          </View>
        </View>

        {/* Hint */}
        <Text style={styles.hint}>
          Don't see the email? Check your spam folder or request a new one.
        </Text>

        {/* Check Verification Button */}
        <TouchableOpacity
          style={styles.checkButton}
          onPress={handleCheckVerification}
          disabled={checking}>
          {checking ? (
            <ActivityIndicator size="small" color={GP.primary} />
          ) : (
            <>
              <Ionicons name="refresh-outline" size={20} color={GP.primary} />
              <Text style={styles.checkButtonText}>I've verified my email</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Resend Button */}
        <TouchableOpacity
          style={[
            styles.resendButton,
            (loading || cooldown > 0) && styles.resendButtonDisabled,
          ]}
          onPress={handleResendVerification}
          disabled={loading || cooldown > 0}>
          {loading ? (
            <ActivityIndicator size="small" color={GP.primary} />
          ) : (
            <Text style={styles.resendButtonText}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Verification Email'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Back to Login Button */}
        <TouchableOpacity
          style={styles.loginButton}
          onPress={handleBackToLogin}>
          <Text style={styles.loginButtonText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  header: {
    paddingHorizontal: 16,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  headerBadge: {
    width: 88,
    height: 88,
    borderRadius: 28,
    backgroundColor: GP.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: GP.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: GP.textSecondary,
    textAlign: 'center',
  },
  emailText: {
    fontSize: 17,
    color: GP.primary,
    fontWeight: '600',
    marginTop: 4,
  },
  emailMissing: {
    fontSize: 16,
    color: GP.textMuted,
    fontStyle: 'italic',
    marginTop: 4,
  },
  instructionsContainer: {
    backgroundColor: GP.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: GP.border,
    gap: 16,
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  instructionBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: GP.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  instructionNumber: {
    color: GP.textOnYellow,
    fontSize: 15,
    fontWeight: '700',
  },
  instructionText: {
    fontSize: 15,
    color: GP.textPrimary,
    fontWeight: '500',
  },
  hint: {
    fontSize: 14,
    color: GP.textMuted,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  checkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GP.surface,
    borderWidth: 1.5,
    borderColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 12,
  },
  checkButtonText: {
    color: GP.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  resendButton: {
    backgroundColor: GP.surface,
    borderWidth: 1.5,
    borderColor: GP.border,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  resendButtonDisabled: {
    opacity: 0.6,
  },
  resendButtonText: {
    color: GP.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  loginButton: {
    backgroundColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  loginButtonText: {
    color: GP.textOnYellow,
    fontSize: 16,
    fontWeight: '700',
  },
});
