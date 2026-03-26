/**
 * PinEntry - Reusable PIN input component with number pad and biometric support
 */
import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { GP } from '@/constants/colors';

interface PinEntryProps {
  /** Number of PIN digits (default: 4) */
  length?: number;
  /** Called when PIN is complete */
  onComplete: (pin: string) => void;
  /** Called when biometric button is pressed */
  onBiometricPress?: () => void;
  /** Whether to show biometric button */
  showBiometric?: boolean;
  /** Type of biometric (for display) */
  biometricType?: 'Face ID' | 'Fingerprint' | 'Iris' | null;
  /** Error message to display */
  error?: string;
  /** Title text */
  title?: string;
  /** Subtitle text */
  subtitle?: string;
  /** Whether input is disabled (e.g., during lockout) */
  disabled?: boolean;
  /** Lockout message to display */
  lockoutMessage?: string;
}

export function PinEntry({
  length = 4,
  onComplete,
  onBiometricPress,
  showBiometric = false,
  biometricType,
  error,
  title = 'Enter PIN',
  subtitle,
  disabled = false,
  lockoutMessage,
}: PinEntryProps) {
  const [pin, setPin] = useState('');
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Reset PIN when error changes
  useEffect(() => {
    if (error) {
      setPin('');
      triggerShake();
      Vibration.vibrate(200);
    }
  }, [error]);

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleDigitPress = async (digit: string) => {
    if (disabled) return;

    // Haptic feedback
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    const newPin = pin + digit;
    setPin(newPin);

    if (newPin.length === length) {
      onComplete(newPin);
    }
  };

  const handleDelete = async () => {
    if (disabled) return;

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}

    setPin(pin.slice(0, -1));
  };

  const handleBiometricPress = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    onBiometricPress?.();
  };

  const getBiometricIcon = () => {
    switch (biometricType) {
      case 'Face ID':
        return '😊';
      case 'Fingerprint':
        return '👆';
      case 'Iris':
        return '👁️';
      default:
        return '🔐';
    }
  };

  // Render dots
  const renderDots = () => (
    <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
      {Array.from({ length }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            pin.length > i && styles.dotFilled,
            disabled && styles.dotDisabled,
          ]}
        />
      ))}
    </Animated.View>
  );

  // Render number pad
  const renderPad = () => {
    const rows = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      [showBiometric ? 'bio' : '', '0', '⌫'],
    ];

    return (
      <View style={styles.pad}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.padRow}>
            {row.map((key, ci) => {
              if (key === '') {
                return <View key={ci} style={styles.padButtonEmpty} />;
              }

              if (key === 'bio') {
                return (
                  <TouchableOpacity
                    key={ci}
                    style={[styles.padButton, styles.padButtonBio]}
                    onPress={handleBiometricPress}
                    disabled={disabled}
                    accessibilityLabel={`Use ${biometricType ?? 'biometrics'}`}
                    accessibilityRole="button">
                    <Text style={styles.padTextBio}>{getBiometricIcon()}</Text>
                  </TouchableOpacity>
                );
              }

              if (key === '⌫') {
                return (
                  <TouchableOpacity
                    key={ci}
                    style={[styles.padButton, disabled && styles.padButtonDisabled]}
                    onPress={handleDelete}
                    disabled={disabled || pin.length === 0}
                    accessibilityLabel="Delete"
                    accessibilityRole="button">
                    <Text style={[styles.padText, pin.length === 0 && styles.padTextMuted]}>
                      ⌫
                    </Text>
                  </TouchableOpacity>
                );
              }

              return (
                <TouchableOpacity
                  key={ci}
                  style={[styles.padButton, disabled && styles.padButtonDisabled]}
                  onPress={() => handleDigitPress(key)}
                  disabled={disabled}
                  accessibilityLabel={key}
                  accessibilityRole="button">
                  <Text style={styles.padText}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>

      {/* Lockout message */}
      {lockoutMessage ? (
        <View style={styles.lockoutContainer}>
          <Text style={styles.lockoutIcon}>🔒</Text>
          <Text style={styles.lockoutText}>{lockoutMessage}</Text>
        </View>
      ) : (
        <>
          {/* PIN dots */}
          {renderDots()}

          {/* Error message */}
          <View style={styles.errorContainer}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          {/* Number pad */}
          {renderPad()}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: GP.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: GP.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 8,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: GP.border,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: GP.primary,
    borderColor: GP.primary,
  },
  dotDisabled: {
    opacity: 0.4,
  },
  errorContainer: {
    height: 24,
    justifyContent: 'center',
    marginBottom: 8,
  },
  error: {
    color: GP.error,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  pad: {
    marginTop: 12,
    gap: 12,
  },
  padRow: {
    flexDirection: 'row',
    gap: 20,
  },
  padButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: GP.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  padButtonEmpty: {
    width: 70,
    height: 70,
  },
  padButtonBio: {
    backgroundColor: GP.card,
    borderWidth: 1,
    borderColor: GP.border,
  },
  padButtonDisabled: {
    opacity: 0.4,
  },
  padText: {
    fontSize: 28,
    fontWeight: '600',
    color: GP.textPrimary,
  },
  padTextMuted: {
    color: GP.textMuted,
  },
  padTextBio: {
    fontSize: 24,
  },
  lockoutContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  lockoutIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  lockoutText: {
    fontSize: 16,
    color: GP.error,
    fontWeight: '600',
    textAlign: 'center',
  },
});
