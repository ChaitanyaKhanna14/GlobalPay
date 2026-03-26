/**
 * AppLockContext - Biometric / PIN lock for wallet protection
 * Prompts on app foreground and before sensitive actions (send, export)
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { AppState, AppStateStatus, Alert } from 'react-native';

const PIN_KEY = 'globalpay_app_pin';
const LOCK_ENABLED_KEY = 'globalpay_lock_enabled';
const FAILED_ATTEMPTS_KEY = 'globalpay_failed_pin_attempts';
const LOCKOUT_UNTIL_KEY = 'globalpay_lockout_until';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

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
    await SecureStore.setItemAsync(PIN_KEY, pin);
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

    const stored = await SecureStore.getItemAsync(PIN_KEY);
    if (stored === pin) {
      // Success - reset failed attempts
      await SecureStore.deleteItemAsync(FAILED_ATTEMPTS_KEY);
      await SecureStore.deleteItemAsync(LOCKOUT_UNTIL_KEY);
      setFailedAttempts(0);
      setLockoutUntil(null);
      setIsLocked(false);
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
      return { success: false, lockoutMinutes: 30 };
    }

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
