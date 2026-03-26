/**
 * Complete Signup Screen - For social/phone users who need to set username
 */
import { useState, useEffect } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/auth-context';
import { GP } from '@/constants/colors';

export default function CompleteSignupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tempUserId: string; email: string }>();
  const insets = useSafeAreaInsets();
  const { completeSocialSignup, checkUsernameAvailability } = useAuth();

  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [loading, setLoading] = useState(false);

  // Generate initial username from email
  useEffect(() => {
    if (params.email) {
      const emailUsername = params.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      setUsername(emailUsername.slice(0, 20));
    }
  }, [params.email]);

  // Check username availability
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

  const handleComplete = async () => {
    if (!username || username.length < 3) {
      Alert.alert('Error', 'Username must be at least 3 characters');
      return;
    }

    if (usernameAvailable === false) {
      Alert.alert('Error', 'This username is already taken');
      return;
    }

    if (!params.tempUserId) {
      Alert.alert('Error', 'Session expired. Please try again.');
      router.replace('/(auth)' as any);
      return;
    }

    setLoading(true);
    const result = await completeSocialSignup({
      tempUserId: params.tempUserId,
      username,
    });
    setLoading(false);

    if (result.error) {
      Alert.alert('Error', result.error.message);
    }
    // Success - auth context handles navigation
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={GP.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <View style={styles.iconBadge}>
            <Ionicons name="person-add" size={40} color={GP.textOnYellow} />
          </View>
        </View>

        <Text style={styles.title}>Almost there!</Text>
        <Text style={styles.subtitle}>
          Choose a username for your GlobalPay account. This will be your unique payment ID.
        </Text>

        {params.email && (
          <View style={styles.emailBadge}>
            <Ionicons name="mail-outline" size={18} color={GP.textSecondary} />
            <Text style={styles.emailText}>{params.email}</Text>
          </View>
        )}

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Username</Text>
          <View style={styles.usernameInputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="Choose a username"
              placeholderTextColor={GP.inputPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={(text) => setUsername(text.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              maxLength={20}
              autoFocus
            />
            {checkingUsername && (
              <ActivityIndicator size="small" color={GP.primary} style={styles.inputStatus} />
            )}
            {!checkingUsername && usernameAvailable !== null && (
              <Ionicons
                name={usernameAvailable ? 'checkmark-circle' : 'close-circle'}
                size={24}
                color={usernameAvailable ? GP.success : GP.error}
                style={styles.inputStatus}
              />
            )}
          </View>
          
          {username.length > 0 && username.length < 3 && (
            <Text style={styles.errorText}>Username must be at least 3 characters</Text>
          )}
          
          {usernameAvailable === false && (
            <Text style={styles.errorText}>This username is already taken</Text>
          )}
        </View>

        {username.length >= 3 && (
          <View style={styles.previewContainer}>
            <Text style={styles.previewLabel}>Your GlobalPay ID</Text>
            <View style={styles.previewBadge}>
              <Text style={styles.previewText}>{username}@globalpay</Text>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.button,
            (loading || usernameAvailable === false || username.length < 3) && styles.buttonDisabled,
          ]}
          onPress={handleComplete}
          disabled={loading || usernameAvailable === false || username.length < 3}>
          {loading ? (
            <ActivityIndicator color={GP.textOnYellow} />
          ) : (
            <Text style={styles.buttonText}>Complete Setup</Text>
          )}
        </TouchableOpacity>
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
  iconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconBadge: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: GP.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: GP.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: GP.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GP.surface,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignSelf: 'center',
    marginBottom: 32,
  },
  emailText: {
    fontSize: 14,
    color: GP.textSecondary,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: GP.textSecondary,
    marginBottom: 8,
  },
  usernameInputWrapper: {
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
  errorText: {
    fontSize: 13,
    color: GP.error,
    marginTop: 6,
  },
  previewContainer: {
    marginBottom: 32,
  },
  previewLabel: {
    fontSize: 13,
    color: GP.textMuted,
    marginBottom: 8,
    textAlign: 'center',
  },
  previewBadge: {
    backgroundColor: GP.surface,
    borderWidth: 1,
    borderColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  previewText: {
    fontSize: 18,
    fontWeight: '700',
    color: GP.primary,
  },
  button: {
    backgroundColor: GP.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: GP.textOnYellow,
    fontSize: 16,
    fontWeight: '700',
  },
});
