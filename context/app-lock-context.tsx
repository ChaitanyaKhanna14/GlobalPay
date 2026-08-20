/**
 * AppLockContext - Biometric / PIN lock for wallet protection
 * Prompts on app foreground and before sensitive actions (send, export)
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import * as SecureStore from '@/services/secure-storage';
import { AppState, AppStateStatus, Alert } from 'react-native';
import { useAuth } from '@/context/auth-context';
import {
  recordPinFailure,
  recordPinLockout,
  recordPinSuccess,
} from '@/services/security/instrument';

const PIN_KEY = 'globalpay_app_pin';
const LOCK_ENABLED_KEY = 'globalpay_lock_enabled';
const FAILED_ATTEMPTS_KEY = 'globalpay_failed_pin_attempts';
const LOCKOUT_UNTIL_KEY = 'globalpay_lockout_until';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// ─── PIN storage ────────────────────────────────
/**
 * The PIN is stored as a salted SHA-256 digest, never in plaintext.
 *
 * SecureStore is backed by the Keychain/Keystore and is already hard to read,
 * but defence in depth matters most exactly where it looks unnecessary: on a
 * rooted or jailbroken device that protection is gone, and a plaintext PIN is
 * then readable outright — and PINs get reused for phone unlock and bank cards.
 *
 * The salt is a build-time constant rather than per-user because there is a
 * single PIN per device, so there is no cross-user rainbow-table exposure to
 * defend against; its job is to stop a precomputed table of the 10,000 possible
 * four-digit digests from working directly. Brute force is bounded by the
 * five-attempt progressive lockout above, not by hash cost — which is why a
 * single SHA-256 round is adequate here where it would not be for a password.
 */
const PIN_SALT = 'globalpay.v1.pin';
/** Marks a stored value as hashed, so pre-existing plaintext PINs are detectable. */
const PIN_HASH_PREFIX = 'sha256$';

async function hashPin(pin: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${PIN_SALT}:${pin}`,
  );
  return `${PIN_HASH_PREFIX}${digest}`;
}

/**
 * Compare digests without early exit.
 *
 * Timing leakage on a locally stored digest is largely theoretical, but writing
 * the comparison correctly costs nothing and keeps the habit intact where it
 * does matter.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

interface PinVerifyResult {
  success: boolean;
  attemptsRemaining?: number;
  lockoutMinutes?: number;
}

interface AppLockContextType {
  isLocked: boolean;
  isLockEnabled: boolean;
  hasBiometrics: boolean;
  biometricType: string | null;
  failedAttempts: number;
  lockoutUntil: number | null;
  unlock: () => Promise<boolean>;
  enableLock: () => Promise<void>;
  disableLock: () => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<PinVerifyResult>;
  hasPin: () => Promise<boolean>;
  authenticateForAction: (reason?: string) => Promise<boolean>;
  getRemainingLockoutTime: () => Promise<number | null>;
  resetLockout: () => Promise<void>;
}

const AppLockContext = createContext<AppLockContextType | undefined>(undefined);

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const [isLockEnabled, setIsLockEnabled] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [biometricType, setBiometricType] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const appState = useRef(AppState.currentState);
  const lastBackground = useRef<number>(0);

  // The lock screen can be reached before a session is restored, so PIN events
  // fall back to a placeholder subject rather than being dropped — a brute
  // force against the lock screen is worth recording either way.
  const { user } = useAuth();
  const securityUserId = user?.id ?? 'unauthenticated-device';

  // Check biometric availability on mount
  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setHasBiometrics(compatible && enrolled);

      if (compatible && enrolled) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType('Face ID');
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricType('Fingerprint');
        } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
          setBiometricType('Iris');
        }
      }

      // Check if lock is enabled
      const enabled = await SecureStore.getItemAsync(LOCK_ENABLED_KEY);
      if (enabled === 'true') {
        setIsLockEnabled(true);
        setIsLocked(true); // Start locked
      }

      // Load failed attempts count
      const attempts = await SecureStore.getItemAsync(FAILED_ATTEMPTS_KEY);
      if (attempts) {
        setFailedAttempts(parseInt(attempts, 10));
      }

      // Load lockout time
      const lockout = await SecureStore.getItemAsync(LOCKOUT_UNTIL_KEY);
      if (lockout) {
        const lockoutTime = parseInt(lockout, 10);
        if (Date.now() < lockoutTime) {
          setLockoutUntil(lockoutTime);
        } else {
          // Lockout expired, clear it
          await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
          await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
          setFailedAttempts(0);
        }
      }
    })();
  }, []);

  // Lock on app background (after 30 seconds)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current === 'active' && nextState.match(/inactive|background/)) {
        lastBackground.current = Date.now();
      }

      if (
        appState.current.match(/inactive|background/) &&
        nextState === 'active' &&
        isLockEnabled
      ) {
        const elapsed = Date.now() - lastBackground.current;
        if (elapsed > 30_000) {
          setIsLocked(true);
        }
      }

      appState.current = nextState;
    });

    return () => subscription.remove();
  }, [isLockEnabled]);

  const unlock = useCallback(async (): Promise<boolean> => {
    if (!isLockEnabled) {
      setIsLocked(false);
      return true;
    }

    if (hasBiometrics) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock GlobalPay',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: false,
        fallbackLabel: 'Use PIN',
      });

      if (result.success) {
        setIsLocked(false);
        return true;
      }
    }

    // If biometrics failed or unavailable, check PIN
    const storedPin = await SecureStore.getItemAsync(PIN_KEY);
    if (storedPin) {
      // Return false — caller should show PIN entry UI
      return false;
    }

    // No biometrics and no PIN — just unlock
    setIsLocked(false);
    return true;
  }, [isLockEnabled, hasBiometrics]);

  const authenticateForAction = useCallback(
    async (reason = 'Authenticate to continue'): Promise<boolean> => {
      if (!isLockEnabled) return true;

      if (hasBiometrics) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: reason,
          cancelLabel: 'Cancel',
          disableDeviceFallback: false,
        });
        return result.success;
      }

      // Fallback to PIN check
      const storedPin = await SecureStore.getItemAsync(PIN_KEY);
      if (!storedPin) return true; // No auth method set up

      return false; // Caller should show PIN UI
    },
    [isLockEnabled, hasBiometrics],
  );

  const enableLock = async () => {
    await SecureStore.setItemAsync(LOCK_ENABLED_KEY, 'true');
    setIsLockEnabled(true);
  };

  const disableLock = async () => {
    await SecureStore.setItemAsync(LOCK_ENABLED_KEY, 'false');
    setIsLockEnabled(false);
    setIsLocked(false);
  };

  const setPin = async (pin: string) => {
    await SecureStore.setItemAsync(PIN_KEY, await hashPin(pin));
  };

  /**
   * Check a PIN against the stored value.
   *
   * Installs that predate PIN hashing hold a plaintext value. Rather than
   * locking those users out, the first correct entry is verified against the
   * legacy value and then transparently re-stored as a digest — so the upgrade
   * happens silently on next unlock and the plaintext is erased.
   */
  const pinMatches = async (pin: string): Promise<boolean> => {
    const stored = await SecureStore.getItemAsync(PIN_KEY);
    if (!stored) return false;

    if (stored.startsWith(PIN_HASH_PREFIX)) {
      return constantTimeEquals(stored, await hashPin(pin));
    }

    // Legacy plaintext PIN — verify, then migrate.
    if (constantTimeEquals(stored, pin)) {
      await SecureStore.setItemAsync(PIN_KEY, await hashPin(pin));
      __DEV__ && console.log('[AppLock] Migrated stored PIN to salted hash');
      return true;
    }
    return false;
  };

  const verifyPin = async (pin: string): Promise<PinVerifyResult> => {
    // Check if currently locked out
    const lockoutTime = await SecureStore.getItemAsync(LOCKOUT_UNTIL_KEY);
    if (lockoutTime) {
      const lockoutTimestamp = parseInt(lockoutTime, 10);
      if (Date.now() < lockoutTimestamp) {
        const remaining = Math.ceil((lockoutTimestamp - Date.now()) / 60000);
        return { success: false, lockoutMinutes: remaining };
      } else {
        // Lockout expired, clear it
        await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
        await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
        setFailedAttempts(0);
        setLockoutUntil(null);
      }
    }

    if (await pinMatches(pin)) {
      // Success - reset failed attempts
      await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
      await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
      setFailedAttempts(0);
      setLockoutUntil(null);
      setIsLocked(false);
      recordPinSuccess(securityUserId);
      return { success: true };
    }

    // Failed attempt - increment counter
    const currentAttempts = parseInt(await SecureStore.getItemAsync(FAILED_ATTEMPTS_KEY) || '0', 10) + 1;
    await SecureStore.setItemAsync(FAILED_ATTEMPTS_KEY, currentAttempts.toString());
    setFailedAttempts(currentAttempts);

    if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
      // Lock out for 30 minutes
      const newLockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
      await SecureStore.setItemAsync(LOCKOUT_UNTIL_KEY, newLockoutUntil.toString());
      setLockoutUntil(newLockoutUntil);
      recordPinFailure(securityUserId, 0);
      recordPinLockout(securityUserId, LOCKOUT_DURATION_MS / 60000);
      return { success: false, lockoutMinutes: 30 };
    }

    recordPinFailure(securityUserId, MAX_FAILED_ATTEMPTS - currentAttempts);
    return { success: false, attemptsRemaining: MAX_FAILED_ATTEMPTS - currentAttempts };
  };

  const getRemainingLockoutTime = async (): Promise<number | null> => {
    const lockoutTime = await SecureStore.getItemAsync(LOCKOUT_UNTIL_KEY);
    if (lockoutTime) {
      const lockoutTimestamp = parseInt(lockoutTime, 10);
      if (Date.now() < lockoutTimestamp) {
        return Math.ceil((lockoutTimestamp - Date.now()) / 60000);
      }
    }
    return null;
  };

  const resetLockout = async (): Promise<void> => {
    await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
    await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
    setFailedAttempts(0);
    setLockoutUntil(null);
  };

  const hasPin = async (): Promise<boolean> => {
    const stored = await SecureStore.getItemAsync(PIN_KEY);
    return !!stored;
  };

  return (
    <AppLockContext.Provider
      value={{
        isLocked,
        isLockEnabled,
        hasBiometrics,
        biometricType,
        failedAttempts,
        lockoutUntil,
        unlock,
        enableLock,
        disableLock,
        setPin,
        verifyPin,
        hasPin,
        authenticateForAction,
        getRemainingLockoutTime,
        resetLockout,
      }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const context = useContext(AppLockContext);
  if (!context) {
    throw new Error('useAppLock must be used within an AppLockProvider');
  }
  return context;
}
