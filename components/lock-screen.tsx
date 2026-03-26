/**
 * Lock Screen - Shown when app is locked, supports biometric + PIN with lockout
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
} from 'react-native';
import { useAppLock } from '@/context/app-lock-context';
import { GP } from '@/constants/colors';

export function LockScreen() {
  const { unlock, verifyPin, biometricType, hasBiometrics, lockoutUntil, getRemainingLockoutTime } = useAppLock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [showingPin, setShowingPin] = useState(false);
  const [lockoutMinutes, setLockoutMinutes] = useState<number | null>(null);

  useEffect(() => {
    // Auto-attempt biometric on mount
    attemptBiometric();
    // Check initial lockout state
    checkLockout();
  }, []);

  // Update lockout timer every minute
  useEffect(() => {
    if (lockoutUntil && lockoutUntil > Date.now()) {
      const interval = setInterval(() => {
        const remaining = Math.ceil((lockoutUntil - Date.now()) / 60000);
        if (remaining <= 0) {
          setLockoutMinutes(null);
          clearInterval(interval);
        } else {
          setLockoutMinutes(remaining);
        }
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [lockoutUntil]);

  const checkLockout = async () => {
    const remaining = await getRemainingLockoutTime();
    if (remaining) {
      setLockoutMinutes(remaining);
      setShowingPin(true);
    }
  };

  const attemptBiometric = async () => {
    const success = await unlock();
    if (!success) {
      setShowingPin(true);
    }
  };

  const handlePinPress = async (digit: string) => {
    if (lockoutMinutes) return;

    setError('');
    const newPin = pin + digit;
    setPin(newPin);

    if (newPin.length === 4) {
      const result = await verifyPin(newPin);
      if (!result.success) {
        Vibration.vibrate(200);
        if (result.lockoutMinutes) {
          setLockoutMinutes(result.lockoutMinutes);
          setError(`Too many attempts. Locked for ${result.lockoutMinutes} minutes.`);
        } else if (result.attemptsRemaining !== undefined) {
          setError(`Incorrect PIN. ${result.attemptsRemaining} attempts remaining.`);
        } else {
          setError('Incorrect PIN');
        }
        setPin('');
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError('');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.title}>GlobalPay Locked</Text>
        <Text style={styles.subtitle}>
          {lockoutMinutes
            ? `Too many failed attempts`
            : showingPin
            ? 'Enter your 4-digit PIN'
            : 'Authenticate to continue'}
        </Text>
      </View>

      {lockoutMinutes ? (
        <View style={styles.lockoutContainer}>
          <Text style={styles.lockoutIcon}>⏱️</Text>
          <Text style={styles.lockoutText}>
            Try again in {lockoutMinutes} minute{lockoutMinutes !== 1 ? 's' : ''}
          </Text>
          {hasBiometrics && (
            <TouchableOpacity style={styles.biometricBtn} onPress={attemptBiometric}>
              <Text style={styles.biometricText}>
                {biometricType === 'Face ID' ? '😊' : '👆'} Use {biometricType ?? 'Biometrics'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : showingPin && (
        <>
          {/* PIN dots */}
          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[styles.dot, pin.length > i && styles.dotFilled]}
              />
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* Number pad */}
          <View style={styles.pad}>
            {[
              ['1', '2', '3'],
              ['4', '5', '6'],
              ['7', '8', '9'],
              ['', '0', '⌫'],
            ].map((row, ri) => (
              <View key={ri} style={styles.padRow}>
                {row.map((digit, ci) => (
                  <TouchableOpacity
                    key={ci}
                    style={[styles.padButton, !digit && styles.padButtonEmpty]}
                    disabled={!digit}
                    onPress={() => {
                      if (digit === '⌫') handleDelete();
                      else handlePinPress(digit);
                    }}>
                    <Text style={styles.padText}>{digit}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
        </>
      )}

      {!lockoutMinutes && hasBiometrics && (
        <TouchableOpacity style={styles.biometricBtn} onPress={attemptBiometric}>
          <Text style={styles.biometricText}>
            {biometricType === 'Face ID' ? '😊' : '👆'} Use {biometricType ?? 'Biometrics'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GP.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  lockIcon: {
    fontSize: 56,
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: GP.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: GP.textSecondary,
    marginTop: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 12,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: GP.textMuted,
  },
  dotFilled: {
    backgroundColor: GP.primary,
    borderColor: GP.primary,
  },
  error: {
    color: GP.error,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    height: 20,
  },
  lockoutContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  lockoutIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  lockoutText: {
    fontSize: 18,
    fontWeight: '600',
    color: GP.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  pad: {
    marginTop: 20,
    gap: 12,
  },
  padRow: {
    flexDirection: 'row',
    gap: 20,
  },
  padButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: GP.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  padButtonEmpty: {
    backgroundColor: 'transparent',
  },
  padText: {
    fontSize: 28,
    fontWeight: '600',
    color: GP.textPrimary,
  },
  biometricBtn: {
    marginTop: 32,
    paddingVertical: 14,
    paddingHorizontal: 28,
    backgroundColor: GP.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GP.border,
  },
  biometricText: {
    fontSize: 16,
    fontWeight: '700',
    color: GP.primary,
  },
});
