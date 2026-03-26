/**
 * Phone Auth Screen - Phone number OTP authentication
 */
import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/auth-context';
import { GP } from '@/constants/colors';

type Step = 'phone' | 'otp' | 'username';

const COUNTRY_CODES = [
  { code: '+1', country: 'US', flag: '🇺🇸' },
  { code: '+91', country: 'IN', flag: '🇮🇳' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+61', country: 'AU', flag: '🇦🇺' },
  { code: '+81', country: 'JP', flag: '🇯🇵' },
  { code: '+49', country: 'DE', flag: '🇩🇪' },
  { code: '+33', country: 'FR', flag: '🇫🇷' },
  { code: '+86', country: 'CN', flag: '🇨🇳' },
];

export default function PhoneAuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sendOTP, verifyOTP, completePhoneSignup, checkUsernameAvailability } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const otpRefs = useRef<(TextInput | null)[]>([]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Username availability check
  useEffect(() => {
    if (step !== 'username' || username.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      const result = await checkUsernameAvailability(username);
      setUsernameAvailable(result.available);
    }, 500);

    return () => clearTimeout(timer);
  }, [username, step]);

  const formatPhoneForDisplay = () => {
    return `${countryCode} ${phone}`;
  };

  const handleSendOTP = async () => {
    if (!phone || phone.length < 6) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    setLoading(true);
    const result = await sendOTP({ phone, countryCode });
    setLoading(false);

    if (result.error) {
      Alert.alert('Error', result.error.message);
    } else {
      setStep('otp');
      setResendCooldown(60);
    }
  };

  const handleOtpChange = (value: string, index: number) => {
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-focus next input
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    // Auto-submit when complete
    if (index === 5 && value) {
      const fullOtp = newOtp.join('');
      if (fullOtp.length === 6) {
        handleVerifyOTP(fullOtp);
      }
    }
  };

  const handleOtpKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOTP = async (otpCode?: string) => {
    const code = otpCode ?? otp.join('');
    if (code.length !== 6) {
      Alert.alert('Error', 'Please enter the 6-digit code');
      return;
    }

    setLoading(true);
    const result = await verifyOTP({ phone: `${countryCode}${phone.replace(/\D/g, '')}`, otp: code });
    setLoading(false);

    if (result.error) {
      Alert.alert('Error', result.error.message);
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } else if (result.needsUsername) {
      setStep('username');
    }
    // If not needsUsername, auth context handles navigation
  };

  const handleResendOTP = async () => {
    if (resendCooldown > 0) return;

    setLoading(true);
    const result = await sendOTP({ phone, countryCode });
    setLoading(false);

    if (result.error) {
      Alert.alert('Error', result.error.message);
    } else {
      setResendCooldown(60);
      Alert.alert('Success', 'A new code has been sent to your phone');
    }
  };

  const handleCompleteSignup = async () => {
    if (!username || username.length < 3) {
      Alert.alert('Error', 'Username must be at least 3 characters');
      return;
    }

    if (usernameAvailable === false) {
      Alert.alert('Error', 'This username is already taken');
      return;
    }

    setLoading(true);
    const result = await completePhoneSignup(username);
    setLoading(false);

    if (result.error) {
      Alert.alert('Error', result.error.message);
    }
    // Success - auth context handles navigation
  };

  const renderPhoneStep = () => (
    <>
      <Text style={styles.title}>Enter your phone number</Text>
      <Text style={styles.subtitle}>We'll send you a verification code</Text>

      <View style={styles.phoneInputContainer}>
        <TouchableOpacity
          style={styles.countryCodeButton}
          onPress={() => setShowCountryPicker(!showCountryPicker)}>
          <Text style={styles.countryCodeText}>
            {COUNTRY_CODES.find((c) => c.code === countryCode)?.flag} {countryCode}
          </Text>
          <Ionicons name="chevron-down" size={16} color={GP.textSecondary} />
        </TouchableOpacity>

        <TextInput
          style={styles.phoneInput}
          placeholder="Phone number"
          placeholderTextColor={GP.inputPlaceholder}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          autoFocus
        />
      </View>

      {showCountryPicker && (
        <View style={styles.countryPicker}>
          {COUNTRY_CODES.map((country) => (
            <TouchableOpacity
              key={country.code}
              style={styles.countryOption}
              onPress={() => {
                setCountryCode(country.code);
                setShowCountryPicker(false);
              }}>
              <Text style={styles.countryOptionText}>
                {country.flag} {country.country} ({country.code})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSendOTP}
        disabled={loading}>
        {loading ? (
          <ActivityIndicator color={GP.textOnYellow} />
        ) : (
          <Text style={styles.buttonText}>Send Code</Text>
        )}
      </TouchableOpacity>
    </>
  );

  const renderOtpStep = () => (
    <>
      <Text style={styles.title}>Enter verification code</Text>
      <Text style={styles.subtitle}>
        Sent to {formatPhoneForDisplay()}
      </Text>

      <View style={styles.otpContainer}>
        {otp.map((digit, index) => (
          <TextInput
            key={index}
            ref={(ref) => (otpRefs.current[index] = ref)}
            style={[styles.otpInput, digit && styles.otpInputFilled]}
            value={digit}
            onChangeText={(value) => handleOtpChange(value.slice(-1), index)}
            onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, index)}
            keyboardType="number-pad"
            maxLength={1}
            autoFocus={index === 0}
          />
        ))}
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={() => handleVerifyOTP()}
        disabled={loading}>
        {loading ? (
          <ActivityIndicator color={GP.textOnYellow} />
        ) : (
          <Text style={styles.buttonText}>Verify</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.resendButton}
        onPress={handleResendOTP}
        disabled={resendCooldown > 0}>
        <Text style={[styles.resendText, resendCooldown > 0 && styles.resendTextDisabled]}>
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.changePhoneButton} onPress={() => setStep('phone')}>
        <Text style={styles.changePhoneText}>Change phone number</Text>
      </TouchableOpacity>
    </>
  );

  const renderUsernameStep = () => (
    <>
      <Text style={styles.title}>Choose a username</Text>
      <Text style={styles.subtitle}>This will be your GlobalPay ID</Text>

      <View style={styles.usernameInputContainer}>
        <TextInput
          style={styles.usernameInput}
          placeholder="username"
          placeholderTextColor={GP.inputPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={(text) => setUsername(text.toLowerCase().replace(/[^a-z0-9]/g, ''))}
          autoFocus
        />
        {usernameAvailable !== null && (
          <View style={styles.usernameStatus}>
            <Ionicons
              name={usernameAvailable ? 'checkmark-circle' : 'close-circle'}
              size={24}
              color={usernameAvailable ? GP.success : GP.error}
            />
          </View>
        )}
      </View>

      {username.length >= 3 && (
        <Text style={styles.globalPayIdPreview}>
          Your GlobalPay ID: <Text style={styles.globalPayIdText}>{username}@globalpay</Text>
        </Text>
      )}

      <TouchableOpacity
        style={[styles.button, (loading || usernameAvailable === false) && styles.buttonDisabled]}
        onPress={handleCompleteSignup}
        disabled={loading || usernameAvailable === false}>
        {loading ? (
          <ActivityIndicator color={GP.textOnYellow} />
        ) : (
          <Text style={styles.buttonText}>Complete Setup</Text>
        )}
      </TouchableOpacity>
    </>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (step === 'otp') setStep('phone');
            else router.back();
          }}>
          <Ionicons name="arrow-back" size={24} color={GP.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {step === 'phone' && renderPhoneStep()}
        {step === 'otp' && renderOtpStep()}
        {step === 'username' && renderUsernameStep()}
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
    paddingVertical: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: GP.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: GP.textSecondary,
    marginBottom: 32,
  },
  phoneInputContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  countryCodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 15,
    gap: 6,
  },
  countryCodeText: {
    fontSize: 16,
    color: GP.textPrimary,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: GP.inputText,
  },
  countryPicker: {
    backgroundColor: GP.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GP.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  countryOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: GP.border,
  },
  countryOptionText: {
    fontSize: 16,
    color: GP.textPrimary,
  },
  button: {
    backgroundColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: GP.textOnYellow,
    fontSize: 16,
    fontWeight: '700',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 8,
  },
  otpInput: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 52,
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    fontSize: 24,
    fontWeight: '700',
    color: GP.textPrimary,
    textAlign: 'center',
  },
  otpInputFilled: {
    borderColor: GP.primary,
    backgroundColor: GP.surface,
  },
  resendButton: {
    alignItems: 'center',
    marginTop: 20,
  },
  resendText: {
    color: GP.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  resendTextDisabled: {
    color: GP.textMuted,
  },
  changePhoneButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  changePhoneText: {
    color: GP.textSecondary,
    fontSize: 14,
  },
  usernameInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  usernameInput: {
    flex: 1,
    backgroundColor: GP.inputBg,
    borderWidth: 1.5,
    borderColor: GP.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: GP.inputText,
  },
  usernameStatus: {
    position: 'absolute',
    right: 14,
  },
  globalPayIdPreview: {
    fontSize: 14,
    color: GP.textSecondary,
    marginBottom: 24,
  },
  globalPayIdText: {
    color: GP.primary,
    fontWeight: '600',
  },
});
