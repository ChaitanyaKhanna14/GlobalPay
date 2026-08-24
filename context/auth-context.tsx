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
import {
  recordAccountDeleted,
  recordEmailChange,
  recordLoginFailure,
  recordLoginSuccess,
  recordLogout,
  recordPasswordChange,
  recordPasswordResetRequest,
} from '@/services/security/instrument';
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
  /**
   * Guards against logging the same authentication twice. Cleared on sign-out,
   * so the next sign-in is recorded normally.
   */
  const loginRecordedFor = useRef<string | null>(null);

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

          if (!mounted) return;

          if (result) {
            dispatch({ type: 'SET_SESSION', payload: result });
            // Push registration is best-effort and must never affect auth. It is
            // wrapped rather than only .catch()-ed because a synchronous throw
            // (expo-notifications on web) escapes .catch entirely and would
            // otherwise abort initialisation after the session was restored.
            try {
              void notificationService.register(result.user.id).catch((e) =>
                __DEV__ && console.warn('[Auth] Push notification registration failed:', e),
              );
            } catch (e) {
              __DEV__ && console.warn('[Auth] Push notification registration threw:', e);
            }
          } else {
            __DEV__ && console.warn('[Auth] Session exists but profile not found');
            // User might be mid-signup (social/phone) - don't sign out yet
          }
        } else {
          __DEV__ && console.log('[Auth] No existing session');
        }
      } catch (e) {
        __DEV__ && console.error('[Auth] Initialize error:', e);
      } finally {
        /**
         * Always leave the loading state, on every path.
         *
         * Previously each branch had to remember to dispatch SET_INITIALIZED,
         * and any path that missed it — an early return, a throw, a profile
         * lookup that resolved after an unmount — stranded the app on the
         * splash screen forever with no way out.
         *
         * SET_INITIALIZED only clears `isLoading` and sets `isInitialized`; it
         * preserves user/session/isAuthenticated. So dispatching it here is
         * safe even when SET_SESSION has already run above.
         */
        if (mounted) dispatch({ type: 'SET_INITIALIZED' });
      }
    }

    initialize();

    /**
     * Listen for auth changes.
     *
     * The callback is deliberately synchronous, and all real work is deferred
     * to a fresh task.
     *
     * GoTrue invokes this callback *while holding the auth lock*. The previous
     * version was `async` and awaited a profile fetch plus a 1-second retry
     * sleep, so the lock stayed held for seconds — during which the concurrent
     * `getSession()` in initialize() above could not acquire it and timed out
     * with "Lock acquisition timed out after 10000ms". The user then landed on
     * the login screen despite a perfectly valid session.
     *
     * Deferring with setTimeout lets the callback return immediately, releasing
     * the lock before any awaiting begins. This is the pattern Supabase's own
     * documentation prescribes: never await, and never call another Supabase
     * method, inside an onAuthStateChange callback.
     */
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      __DEV__ && console.log('[Auth] onAuthStateChange event:', _event, 'session?', !!session);

      // Skip if we're in the middle of signup
      if (isSigningUp.current) {
        __DEV__ && console.log('[Auth] Skipping — signup in progress');
        return;
      }

      setTimeout(async () => {
        if (!mounted) return;

        if (session) {
          // Try to load profile with retry
          let result = await loadUserProfile(session.user.id, session);
          if (!result) {
            // Retry once after delay
            await new Promise((resolve) => setTimeout(resolve, 1000));
            result = await loadUserProfile(session.user.id, session);
          }

          if (!mounted) return;

          if (result) {
            dispatch({ type: 'SET_SESSION', payload: result });

            /**
             * Record the successful authentication here rather than inside
             * signIn().
             *
             * This is the authoritative signal that a session was established:
             * it fires for every sign-in path, and it does not depend on the
             * second `getSession()` that signIn() makes — a call we have
             * watched lose a race for the auth lock and time out, which would
             * lose the login event entirely.
             *
             * Gating on SIGNED_IN keeps the semantics honest. Restoring a
             * persisted session raises INITIAL_SESSION and a token renewal
             * raises TOKEN_REFRESHED, so neither is reported as a fresh
             * authentication — a resumed session is not someone logging in,
             * and treating it as one would bury real sign-ins in noise.
             */
            if (_event === 'SIGNED_IN' && loginRecordedFor.current !== result.user.id) {
              loginRecordedFor.current = result.user.id;
              recordLoginSuccess(result.user.id, result.user.globalPayId);
            }

            try {
              void notificationService.register(result.user.id).catch(() => {});
            } catch {
              /* push registration must never affect auth */
            }
          }
        } else {
          loginRecordedFor.current = null;
          dispatch({ type: 'CLEAR_SESSION' });
        }
      }, 0);
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
          // The login event is recorded by the onAuthStateChange handler, which
          // sees every sign-in path and cannot be skipped by this optimistic
          // fetch failing or losing the auth lock.
        }
      }
    } else {
      // Failed sign-ins are the raw material for brute-force and credential
      // stuffing detection, so they are logged even though nothing happened.
      recordLoginFailure(data.email, result.error?.message);
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

    if (state.user?.id) {
      recordLogout(state.user.id, state.user.globalPayId);
    }

    await authService.signOut();
    dispatch({ type: 'CLEAR_SESSION' });
  }, [state.user?.id, state.user?.globalPayId]);

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
    recordPasswordResetRequest(email);
    return authService.resetPassword(email);
  }, []);

  // ─── Confirm Password Reset ─────────────────────
  const confirmResetPassword = useCallback(async (data: ConfirmResetPasswordData): Promise<ResetPasswordResult> => {
    const result = await authService.confirmResetPassword(data);
    // A credential change is the middle link of the account-takeover chain, so
    // it is logged regardless of who initiated it.
    if (result.success && state.user?.id) {
      recordPasswordChange(state.user.id, state.user.globalPayId);
    }
    return result;
  }, [state.user?.id, state.user?.globalPayId]);

  // ─── Resend Verification Email ──────────────────
  const resendVerificationEmail = useCallback(async (email: string): Promise<{ error?: AuthError }> => {
    return authService.resendVerificationEmail(email);
  }, []);

  // ─── Change Email ───────────────────────────────
  const changeEmail = useCallback(async (data: ChangeEmailData): Promise<ChangeEmailResult> => {
    const result = await authService.changeEmail(data);
    // Repointing the recovery address is how an attacker locks the real owner
    // out of self-service recovery — a key signal in the takeover chain.
    if (result.success && state.user?.id) {
      recordEmailChange(state.user.id, state.user.globalPayId);
    }
    return result;
  }, [state.user?.id, state.user?.globalPayId]);

  // ─── Delete Account ─────────────────────────────
  const deleteAccount = useCallback(async (password: string): Promise<DeleteAccountResult> => {
    const userId = state.user?.id;
    const actor = state.user?.globalPayId;
    const result = await authService.deleteAccount(password);
    if (result.success) {
      if (userId) recordAccountDeleted(userId, actor);
      dispatch({ type: 'CLEAR_SESSION' });
    }
    return result;
  }, [state.user?.id, state.user?.globalPayId]);

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
