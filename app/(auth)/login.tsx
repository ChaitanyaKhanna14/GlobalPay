/**
 * Login Screen - Email/password with social login options
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Link, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/auth-context';
import { GP } from '@/constants/colors';

export default function LoginScreen() {
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string; fromVerification?: string }>();
  
  const [email, setEmail] = useState(params.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingApple, setLoadingApple] = useState(false);

  // Show message if coming from verification screen
  useEffect(() => {
    if (params.fromVerification === 'true' && params.email) {
      Alert.alert(
        'Welcome Back!',
        'Enter your password to sign in.',
      );
    }
  }, [params.fromVerification, params.email]);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    const result = await signIn({ email, password });
    setLoading(false);

    if (result.error) {
      Alert.alert('Login Failed', result.error.message);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoadingGoogle(true);
    try {
      const result = await signInWithGoogle();
      if (result.needsUsername && result.tempUserId) {
        router.push({
          pathname: '/(auth)/complete-signup',
          params: { tempUserId: result.tempUserId, email: result.email ?? '' },
        } as any);
      } else if (result.error) {
        Alert.alert('Error', result.error.message);
      }
    } catch (e) {
      Alert.alert('Error', 'Something went wrong');
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
        Alert.alert('Error', result.error.message);
      }
    } catch (e) {
      Alert.alert('Error', 'Something went wrong');
    } finally {
      setLoadingApple(false);
    }
  };

  const isAnyLoading = loading || loadingGoogle || loadingApple;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Back button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={GP.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.inner}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoIcon}>⚡</Text>
          </View>
          <Text style={styles.logoText}>Welcome back</Text>
          <Text style={styles.tagline}>Sign in to your account</Text>
        </View>

        {/* Social Login */}
        <View style={styles.socialButtons}>
          <TouchableOpacity
            style={styles.socialButton}
            onPress={handleGoogleSignIn}
            disabled={isAnyLoading}>
            {loadingGoogle ? (
              <ActivityIndicator size="small" color={GP.textPrimary} />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color={GP.textPrimary} />
                <Text style={styles.socialButtonText}>Google</Text>
              </>
            )}
          </TouchableOpacity>

          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={styles.socialButton}
              onPress={handleAppleSignIn}
              disabled={isAnyLoading}>
              {loadingApple ? (
                <ActivityIndicator size="small" color={GP.textPrimary} />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={22} color={GP.textPrimary} />
                  <Text style={styles.socialButtonText}>Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with email</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={GP.inputPlaceholder}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!isAnyLoading}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Enter your password"
              placeholderTextColor={GP.inputPlaceholder}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              editable={!isAnyLoading}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={22}
                color={GP.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.forgotPassword}
            onPress={() => router.push('/(auth)/forgot-password' as any)}>
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, isAnyLoading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={isAnyLoading}>
            {loading ? (
              <ActivityIndicator color={GP.textOnYellow} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Signup link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <Link href={'/(auth)/signup' as any} asChild>
            <TouchableOpacity>
              <Text style={styles.footerLink}>Sign Up</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
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
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: GP.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoIcon: {
    fontSize: 36,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '700',
    color: GP.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 15,
    color: GP.textSecondary,
    marginTop: 4,
  },
  socialButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  socialButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GP.surface,
    borderWidth: 1.5,
    borderColor: GP.border,
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 52,
  },
  socialButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: GP.textPrimary,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: GP.border,
  },
  dividerText: {
    color: GP.textMuted,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  form: {
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: GP.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: GP.inputText,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: GP.inputText,
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 15,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginTop: 10,
    paddingVertical: 4,
  },
  forgotPasswordText: {
    color: GP.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    backgroundColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: GP.textOnYellow,
    fontSize: 16,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  footerText: {
    color: GP.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: GP.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});
