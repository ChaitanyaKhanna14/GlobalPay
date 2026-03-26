/**
 * AuthContext - Manages authentication state across the app
 * Supports email/password, social login (Google, Apple), and phone OTP
 */
import React, { createContext, useContext, useEffect, useReducer, useRef, useCallback } from 'react';
import { supabase } from '@/supabase';
import { notificationService } from '@/services/notifications';
import {
  authService,
  loadUserProfile,
  validatePassword,
  checkUsernameAvailability,
} from '@/services/auth-service';
import type {
  AuthState,
  AuthAction,
  AuthContextType,
  SignUpData,
  SignUpResult,
  SignInData,
  SignInResult,
  SocialAuthResult,
  PhoneAuthData,
  PhoneAuthResult,
  VerifyOTPData,
  VerifyOTPResult,
  ResetPasswordResult,
  ConfirmResetPasswordData,
  ChangeEmailData,
  ChangeEmailResult,
  DeleteAccountResult,
  UsernameCheckResult,
  PasswordValidation,
  CompleteSocialSignupData,
  AuthError,
} from '@/types/auth';

// ─── Initial State ──────────────────────────────
const initialState: AuthState = {
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  isInitialized: false,
};

// ─── Reducer ────────────────────────────────────
function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_INITIALIZED':
      return { ...state, isInitialized: true, isLoading: false };
    case 'SET_SESSION':
      return {
        ...state,
        user: action.payload.user,
        session: action.payload.session,
        isLoading: false,
        isAuthenticated: true,
        isInitialized: true,
      };
    case 'CLEAR_SESSION':
      return {
        ...state,
        user: null,
        session: null,
        isLoading: false,
        isAuthenticated: false,
      };
    case 'UPDATE_USER':
      return state.user
        ? { ...state, user: { ...state.user, ...action.payload } }
        : state;
    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ─── Provider ───────────────────────────────────
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  
  // Prevent auth state change listener from interfering during signup
  const isSigningUp = useRef(false);
  // Track pending social/phone signup that needs username
  const pendingSignup = useRef<{ userId: string; email?: string } | null>(null);

  // ─── Initialize Auth ────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        if (session) {
          __DEV__ && console.log('[Auth] Restoring session for userId:', session.user.id);
          const result = await loadUserProfile(session.user.id, session);
          
          if (result) {
            dispatch({ type: 'SET_SESSION', payload: result });
            // Register for push notifications
            notificationService.register(result.user.id).catch((e) =>
              __DEV__ && console.warn('[Auth] Push notification registration failed:', e),
            );
          } else {
            __DEV__ && console.warn('[Auth] Session exists but profile not found');
            // User might be mid-signup (social/phone) - don't sign out yet
            dispatch({ type: 'SET_INITIALIZED' });
          }
        } else {
          __DEV__ && console.log('[Auth] No existing session');
          dispatch({ type: 'SET_INITIALIZED' });
        }
      } catch (e) {
        __DEV__ && console.error('[Auth] Initialize error:', e);
        dispatch({ type: 'SET_INITIALIZED' });
      }
    }

    initialize();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      __DEV__ && console.log('[Auth] onAuthStateChange event:', _event, 'session?', !!session);
      
      // Skip if we're in the middle of signup
      if (isSigningUp.current) {
        __DEV__ && console.log('[Auth] Skipping — signup in progress');
        return;
      }

      if (session) {
        // Try to load profile with retry
        let result = await loadUserProfile(session.user.id, session);
        if (!result) {
          // Retry once after delay
          await new Promise((resolve) => setTimeout(resolve, 1000));
          result = await loadUserProfile(session.user.id, session);
        }
        
        if (result) {
          dispatch({ type: 'SET_SESSION', payload: result });
          notificationService.register(result.user.id).catch(() => {});
        }
      } else {
        dispatch({ type: 'CLEAR_SESSION' });
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ─── Email/Password Sign Up ─────────────────────
  const signUp = useCallback(async (data: SignUpData): Promise<SignUpResult> => {
    isSigningUp.current = true;
    try {
      const result = await authService.signUpWithEmail(data);
      return result;
    } finally {
      isSigningUp.current = false;
    }
  }, []);

  // ─── Email/Password Sign In ─────────────────────
  const signIn = useCallback(async (data: SignInData): Promise<SignInResult> => {
    const result = await authService.signInWithEmail(data);
    
    if (result.success) {
      // Profile will be loaded by onAuthStateChange listener
      // But let's also try to load it directly for faster UX
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const profile = await loadUserProfile(session.user.id, session);
        if (profile) {
          dispatch({ type: 'SET_SESSION', payload: profile });
          notificationService.register(profile.user.id).catch(() => {});
        }
      }
    }
    
    return result;
  }, []);

  // ─── Sign Out ───────────────────────────────────
  const signOut = useCallback(async (): Promise<void> => {
    try {
      if (state.user?.id) {
        await notificationService.unregister(state.user.id);
      }
    } catch (e) {
      __DEV__ && console.warn('[Auth] Failed to unregister notifications:', e);
    }
    
    await authService.signOut();
    dispatch({ type: 'CLEAR_SESSION' });
  }, [state.user?.id]);

  // ─── Google Sign In ─────────────────────────────
  const signInWithGoogle = useCallback(async (): Promise<SocialAuthResult> => {
    isSigningUp.current = true;
    try {
      const result = await authService.signInWithGoogle();
      
      if (result.success && !result.needsUsername) {
        // Profile exists, load it
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const profile = await loadUserProfile(session.user.id, session);
          if (profile) {
            dispatch({ type: 'SET_SESSION', payload: profile });
            notificationService.register(profile.user.id).catch(() => {});
          }
        }
      } else if (result.needsUsername && result.tempUserId) {
        pendingSignup.current = { userId: result.tempUserId, email: result.email };
      }
      
      return result;
    } finally {
      isSigningUp.current = false;
    }
  }, []);

  // ─── Apple Sign In ──────────────────────────────
  const signInWithApple = useCallback(async (): Promise<SocialAuthResult> => {
    isSigningUp.current = true;
    try {
      const result = await authService.signInWithApple();
      
      if (result.success && !result.needsUsername) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const profile = await loadUserProfile(session.user.id, session);
          if (profile) {
            dispatch({ type: 'SET_SESSION', payload: profile });
            notificationService.register(profile.user.id).catch(() => {});
          }
        }
      } else if (result.needsUsername && result.tempUserId) {
        pendingSignup.current = { userId: result.tempUserId, email: result.email };
      }
      
      return result;
    } finally {
      isSigningUp.current = false;
    }
  }, []);

  // ─── Complete Social Signup ─────────────────────
  const completeSocialSignup = useCallback(async (data: CompleteSocialSignupData): Promise<SignUpResult> => {
    isSigningUp.current = true;
    try {
      const result = await authService.completeSocialSignup(data.tempUserId, data.username);
      
      if (result.success) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const profile = await loadUserProfile(session.user.id, session);
          if (profile) {
            dispatch({ type: 'SET_SESSION', payload: profile });
            notificationService.register(profile.user.id).catch(() => {});
          }
        }
        pendingSignup.current = null;
      }
      
      return result;
    } finally {
      isSigningUp.current = false;
    }
  }, []);

  // ─── Send Phone OTP ─────────────────────────────
  const sendOTP = useCallback(async (data: PhoneAuthData): Promise<PhoneAuthResult> => {
    return authService.sendPhoneOTP(data);
  }, []);

  // ─── Verify Phone OTP ───────────────────────────
  const verifyOTP = useCallback(async (data: VerifyOTPData): Promise<VerifyOTPResult> => {
    isSigningUp.current = true;
    try {
      const result = await authService.verifyPhoneOTP(data);
      
      if (result.success && !result.needsUsername) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const profile = await loadUserProfile(session.user.id, session);
          if (profile) {
            dispatch({ type: 'SET_SESSION', payload: profile });
            notificationService.register(profile.user.id).catch(() => {});
          }
        }
      }
      
      return result;
    } finally {
      isSigningUp.current = false;
    }
  }, []);

  // ─── Complete Phone Signup ──────────────────────
  const completePhoneSignup = useCallback(async (username: string): Promise<SignUpResult> => {
    isSigningUp.current = true;
    try {
      const result = await authService.completePhoneSignup(username);
      
      if (result.success) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const profile = await loadUserProfile(session.user.id, session);
          if (profile) {
            dispatch({ type: 'SET_SESSION', payload: profile });
            notificationService.register(profile.user.id).catch(() => {});
          }
        }
      }
      
      return result;
    } finally {
      isSigningUp.current = false;
    }
  }, []);

  // ─── Password Reset ─────────────────────────────
  const resetPassword = useCallback(async (email: string): Promise<ResetPasswordResult> => {
    return authService.resetPassword(email);
  }, []);

  // ─── Confirm Password Reset ─────────────────────
  const confirmResetPassword = useCallback(async (data: ConfirmResetPasswordData): Promise<ResetPasswordResult> => {
    return authService.confirmResetPassword(data);
  }, []);

  // ─── Resend Verification Email ──────────────────
  const resendVerificationEmail = useCallback(async (email: string): Promise<{ error?: AuthError }> => {
    return authService.resendVerificationEmail(email);
  }, []);

  // ─── Change Email ───────────────────────────────
  const changeEmail = useCallback(async (data: ChangeEmailData): Promise<ChangeEmailResult> => {
    return authService.changeEmail(data);
  }, []);

  // ─── Delete Account ─────────────────────────────
  const deleteAccount = useCallback(async (password: string): Promise<DeleteAccountResult> => {
    const result = await authService.deleteAccount(password);
    if (result.success) {
      dispatch({ type: 'CLEAR_SESSION' });
    }
    return result;
  }, []);

  // ─── Refresh User ───────────────────────────────
  const refreshUser = useCallback(async (): Promise<void> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const profile = await loadUserProfile(session.user.id, session);
      if (profile) {
        dispatch({ type: 'SET_SESSION', payload: profile });
      }
    }
  }, []);

  // ─── Check Username Availability ────────────────
  const checkUsername = useCallback(async (username: string): Promise<UsernameCheckResult> => {
    return checkUsernameAvailability(username);
  }, []);

  // ─── Validate Password ──────────────────────────
  const validatePwd = useCallback((password: string): PasswordValidation => {
    return validatePassword(password);
  }, []);

  // ─── Context Value ──────────────────────────────
  const value: AuthContextType = {
    ...state,
    signUp,
    signIn,
    signOut,
    signInWithGoogle,
    signInWithApple,
    completeSocialSignup,
    sendOTP,
    verifyOTP,
    completePhoneSignup,
    resetPassword,
    confirmResetPassword,
    resendVerificationEmail,
    changeEmail,
    deleteAccount,
    refreshUser,
    checkUsernameAvailability: checkUsername,
    validatePassword: validatePwd,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
