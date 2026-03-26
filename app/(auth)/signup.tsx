/**
 * Signup Screen - Create account with GlobalPay ID
 * Includes username availability check and password strength indicator
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
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/auth-context';
import { GP } from '@/constants/colors';

export default function SignupScreen() {
  const { signUp, checkUsernameAvailability, validatePassword } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const globalPayId = username
    ? `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@globalpay`
    : '';

  const passwordValidation = validatePassword(password);

  // Check username availability with debounce
  useEffect(() => {
    if (username.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    setCheckingUsername(true);
    const timer = setTimeout(async () => {
      const result = await checkUsernameAvailability(username);
      setUsernameAvailable(result.available);
      setCheckingUsername(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [username]);

  const handleSignup = async () => {
    if (!username || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (username.length < 3) {
      Alert.alert('Error', 'Username must be at least 3 characters');
      return;
    }
    if (usernameAvailable === false) {
      Alert.alert('Error', 'This username is already taken');
      return;
    }
    if (!passwordValidation.isValid) {
      Alert.alert('Weak Password', 'Please ensure your password meets all requirements');
      return;
    }
    if (!agreedToTerms) {
      Alert.alert('Terms Required', 'Please agree to the Terms of Service and Privacy Policy');
      return;
    }

    setLoading(true);
    const result = await signUp({ email, password, username });
    setLoading(false);

    if (result.error) {
      Alert.alert('Signup Failed', result.error.message);
    } else if (result.success) {
      Alert.alert(
        'Account Created! 🎉',
        'Your account and wallet are ready. Please sign in to continue.',
        [{ text: 'Sign In', onPress: () => router.replace('/(auth)/login' as any) }],
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Back button */}
      <View style={styles.headerNav}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={GP.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoIcon}>⚡</Text>
          </View>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Set up your GlobalPay ID to send & receive money worldwide</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {/* Username */}
          <Text style={styles.label}>Choose your username</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="rahul"
              placeholderTextColor={GP.inputPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={(text) => setUsername(text.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              maxLength={20}
            />
            {checkingUsername && (
              <ActivityIndicator size="small" color={GP.primary} style={styles.inputStatus} />
            )}
            {!checkingUsername && usernameAvailable !== null && username.length >= 3 && (
              <Ionicons
                name={usernameAvailable ? 'checkmark-circle' : 'close-circle'}
                size={24}
                color={usernameAvailable ? GP.success : GP.error}
                style={styles.inputStatus}
              />
            )}
          </View>
          
          {globalPayId && username.length >= 3 ? (
            <View style={styles.idPreview}>
              <Text style={styles.idPreviewLabel}>Your GlobalPay ID:</Text>
              <Text style={styles.idPreviewValue}>{globalPayId}</Text>
            </View>
          ) : null}

          {usernameAvailable === false && (
            <Text style={styles.errorText}>This username is already taken</Text>
          )}

          {/* Email */}
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={GP.inputPlaceholder}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />

          {/* Password */}
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Create a strong password"
              placeholderTextColor={GP.inputPlaceholder}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
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

          {/* Password Strength */}
          {password.length > 0 && (
            <View style={styles.strengthContainer}>
              <View style={styles.strengthBar}>
                <View
                  style={[
                    styles.strengthFill,
                    {
                      width: `${
                        passwordValidation.strength === 'strong' ? 100 :
                        passwordValidation.strength === 'good' ? 75 :
                        passwordValidation.strength === 'fair' ? 50 : 25
                      }%`,
                      backgroundColor:
                        passwordValidation.strength === 'strong' ? GP.success :
                        passwordValidation.strength === 'good' ? GP.cardGreen :
                        passwordValidation.strength === 'fair' ? GP.warning : GP.error,
                    },
                  ]}
                />
              </View>
              <Text style={styles.strengthText}>
                {passwordValidation.strength.charAt(0).toUpperCase() + passwordValidation.strength.slice(1)}
              </Text>
            </View>
          )}

          {/* Password Requirements */}
          {password.length > 0 && (
            <View style={styles.requirements}>
              <PasswordRequirement met={passwordValidation.hasMinLength} text="At least 8 characters" />
              <PasswordRequirement met={passwordValidation.hasUppercase} text="One uppercase letter" />
              <PasswordRequirement met={passwordValidation.hasNumber} text="One number" />
              <PasswordRequirement met={passwordValidation.hasSpecialChar} text="One special character" />
            </View>
          )}

          {/* Terms Checkbox */}
          <TouchableOpacity
            style={styles.termsRow}
            onPress={() => setAgreedToTerms(!agreedToTerms)}>
            <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
              {agreedToTerms && <Ionicons name="checkmark" size={16} color={GP.textOnYellow} />}
            </View>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Text style={styles.termsLink} onPress={() => router.push('/terms-of-service' as any)}>
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text style={styles.termsLink} onPress={() => router.push('/privacy-policy' as any)}>
                Privacy Policy
              </Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, (loading || !agreedToTerms) && styles.buttonDisabled]}
            onPress={handleSignup}
            disabled={loading || !agreedToTerms}>
            {loading ? (
              <ActivityIndicator color={GP.textOnYellow} />
            ) : (
              <Text style={styles.buttonText}>Create Account</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Login link */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Link href={'/(auth)/login' as any} asChild>
            <TouchableOpacity>
              <Text style={styles.footerLink}>Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PasswordRequirement({ met, text }: { met: boolean; text: string }) {
  return (
    <View style={styles.requirement}>
      <Ionicons
        name={met ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={met ? GP.success : GP.textMuted}
      />
      <Text style={[styles.requirementText, met && styles.requirementTextMet]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
  },
  headerNav: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inner: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: GP.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoIcon: {
    fontSize: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: GP.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: GP.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  form: {
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: GP.textSecondary,
    marginBottom: 6,
    marginTop: 14,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    paddingRight: 48,
    fontSize: 16,
    color: GP.inputText,
  },
  inputStatus: {
    position: 'absolute',
    right: 14,
  },
  idPreview: {
    backgroundColor: GP.surface,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: GP.primary,
  },
  idPreviewLabel: {
    fontSize: 13,
    color: GP.textSecondary,
  },
  idPreviewValue: {
    fontSize: 14,
    fontWeight: '700',
    color: GP.primary,
  },
  errorText: {
    fontSize: 13,
    color: GP.error,
    marginTop: 6,
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
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    backgroundColor: GP.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%',
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 12,
    color: GP.textSecondary,
    fontWeight: '600',
  },
  requirements: {
    marginTop: 12,
    gap: 6,
  },
  requirement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  requirementText: {
    fontSize: 13,
    color: GP.textMuted,
  },
  requirementTextMet: {
    color: GP.textSecondary,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 20,
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: GP.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: GP.primary,
    borderColor: GP.primary,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    color: GP.textSecondary,
    lineHeight: 20,
  },
  termsLink: {
    color: GP.primary,
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
