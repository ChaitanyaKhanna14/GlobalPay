/**
 * Authentication Types
 * Comprehensive type definitions for the GlobalPay auth system
 */

import type { Session } from '@supabase/supabase-js';

// ─── Social Providers ───────────────────────────
export type SocialProvider = 'google' | 'apple';

// ─── Auth Error Codes ───────────────────────────
export type AuthErrorCode =
  | 'EMAIL_ALREADY_EXISTS'
  | 'USERNAME_ALREADY_EXISTS'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_CONFIRMED'
  | 'WEAK_PASSWORD'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'
  | 'INVALID_OTP'
  | 'OTP_EXPIRED'
  | 'NETWORK_ERROR'
  | 'WALLET_CREATION_FAILED'
  | 'PROFILE_CREATION_FAILED'
  | 'USER_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'UNKNOWN_ERROR';

// ─── Auth Error ─────────────────────────────────
export interface AuthError {
  code: AuthErrorCode;
  message: string;
  originalError?: unknown;
}

// ─── User ───────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  phone?: string;
  globalPayId: string;
  displayName: string;
  avatarUrl?: string;
  walletAddress: string;
  createdAt: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  authProvider: 'email' | 'google' | 'apple' | 'phone';
}

// ─── Auth State ─────────────────────────────────
export interface AuthState {
  user: AuthUser | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isInitialized: boolean;
}

// ─── Auth Actions ───────────────────────────────
export type AuthAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_INITIALIZED' }
  | { type: 'SET_SESSION'; payload: { user: AuthUser; session: Session } }
  | { type: 'CLEAR_SESSION' }
  | { type: 'UPDATE_USER'; payload: Partial<AuthUser> };

// ─── Sign Up ────────────────────────────────────
export interface SignUpData {
  email: string;
  password: string;
  username: string;
}

export interface SignUpResult {
  success: boolean;
  error?: AuthError;
  emailVerificationRequired?: boolean;
  email?: string;
}

// ─── Sign In ────────────────────────────────────
export interface SignInData {
  email: string;
  password: string;
}

export interface SignInResult {
  success: boolean;
  error?: AuthError;
  emailNotConfirmed?: boolean;
  email?: string;
}

// ─── Social Auth ────────────────────────────────
export interface SocialAuthResult {
  success: boolean;
  error?: AuthError;
  needsUsername?: boolean;
  tempUserId?: string;
  email?: string;
}

export interface CompleteSocialSignupData {
  tempUserId: string;
  username: string;
}

// ─── Phone Auth ─────────────────────────────────
export interface PhoneAuthData {
  phone: string;
  countryCode: string;
}

export interface PhoneAuthResult {
  success: boolean;
  error?: AuthError;
}

export interface VerifyOTPData {
  phone: string;
  otp: string;
}

export interface VerifyOTPResult {
  success: boolean;
  error?: AuthError;
  needsUsername?: boolean;
  isNewUser?: boolean;
}

// ─── Password Reset ─────────────────────────────
export interface ResetPasswordResult {
  success: boolean;
  error?: AuthError;
}

export interface ConfirmResetPasswordData {
  newPassword: string;
}

// ─── Email Change ───────────────────────────────
export interface ChangeEmailData {
  newEmail: string;
  password: string;
}

export interface ChangeEmailResult {
  success: boolean;
  error?: AuthError;
  verificationRequired?: boolean;
}

// ─── Account Deletion ───────────────────────────
export interface DeleteAccountResult {
  success: boolean;
  error?: AuthError;
}

// ─── Username Check ─────────────────────────────
export interface UsernameCheckResult {
  available: boolean;
  globalPayId?: string;
  error?: AuthError;
}

// ─── Password Validation ────────────────────────
export interface PasswordValidation {
  isValid: boolean;
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
  strength: 'weak' | 'fair' | 'good' | 'strong';
}

// ─── Context Type ───────────────────────────────
export interface AuthContextType extends AuthState {
  // Email/Password Auth
  signUp: (data: SignUpData) => Promise<SignUpResult>;
  signIn: (data: SignInData) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  
  // Social Auth
  signInWithGoogle: () => Promise<SocialAuthResult>;
  signInWithApple: () => Promise<SocialAuthResult>;
  completeSocialSignup: (data: CompleteSocialSignupData) => Promise<SignUpResult>;
  
  // Phone Auth
  sendOTP: (data: PhoneAuthData) => Promise<PhoneAuthResult>;
  verifyOTP: (data: VerifyOTPData) => Promise<VerifyOTPResult>;
  completePhoneSignup: (username: string) => Promise<SignUpResult>;
  
  // Password Management
  resetPassword: (email: string) => Promise<ResetPasswordResult>;
  confirmResetPassword: (data: ConfirmResetPasswordData) => Promise<ResetPasswordResult>;
  
  // Email Management
  resendVerificationEmail: (email: string) => Promise<{ error?: AuthError }>;
  changeEmail: (data: ChangeEmailData) => Promise<ChangeEmailResult>;
  
  // Account Management
  deleteAccount: (password: string) => Promise<DeleteAccountResult>;
  refreshUser: () => Promise<void>;
  
  // Utilities
  checkUsernameAvailability: (username: string) => Promise<UsernameCheckResult>;
  validatePassword: (password: string) => PasswordValidation;
}
