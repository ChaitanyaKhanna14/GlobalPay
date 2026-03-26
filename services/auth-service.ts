/**
 * Auth Service
 * Centralized authentication logic for GlobalPay
 * Handles email/password, social login (Google, Apple), and phone OTP
 * 
 * NOTE: Social login (Google/Apple) requires a custom dev build, not Expo Go.
 * Phone OTP requires Supabase phone auth to be enabled.
 */

import { supabase } from '@/supabase';
import { walletService } from '@/services/wallet';
import type {
  AuthError,
  AuthErrorCode,
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
  AuthUser,
} from '@/types/auth';
import type { Session } from '@supabase/supabase-js';

// Dynamic imports for social login (only available in custom dev builds)
let AppleAuthentication: any = null;
let AuthSession: any = null;
let Crypto: any = null;
let WebBrowser: any = null;

// Try to import social login packages (will fail gracefully in Expo Go)
async function loadSocialAuthModules() {
  try {
    AppleAuthentication = await import('expo-apple-authentication');
    AuthSession = await import('expo-auth-session');
    Crypto = await import('expo-crypto');
    WebBrowser = await import('expo-web-browser');
    WebBrowser.maybeCompleteAuthSession();
    return true;
  } catch (e) {
    __DEV__ && console.log('[AuthService] Social auth modules not available (Expo Go mode)');
    return false;
  }
}

// Initialize on load
loadSocialAuthModules();

// ─── Error Mapping ──────────────────────────────
function createAuthError(code: AuthErrorCode, message: string, originalError?: unknown): AuthError {
  return { code, message, originalError };
}

function mapSupabaseError(error: any): AuthError {
  const message = error?.message?.toLowerCase() ?? '';
  
  if (message.includes('already registered') || message.includes('already exists')) {
    return createAuthError('EMAIL_ALREADY_EXISTS', 'This email is already registered. Please sign in instead.');
  }
  if (message.includes('invalid login credentials') || message.includes('invalid password')) {
    return createAuthError('INVALID_CREDENTIALS', 'Invalid email or password. Please try again.');
  }
  if (message.includes('email not confirmed')) {
    return createAuthError('EMAIL_NOT_CONFIRMED', 'Please verify your email before signing in.');
  }
  if (message.includes('weak password') || message.includes('password')) {
    return createAuthError('WEAK_PASSWORD', 'Password does not meet requirements.');
  }
  if (message.includes('invalid email')) {
    return createAuthError('INVALID_EMAIL', 'Please enter a valid email address.');
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    // Don't show rate limit error, just show a generic retry message
    return createAuthError('UNKNOWN_ERROR', 'Please wait a moment and try again.');
  }
  if (message.includes('network') || message.includes('fetch')) {
    return createAuthError('NETWORK_ERROR', 'Network error. Please check your connection.');
  }
  
  return createAuthError('UNKNOWN_ERROR', error?.message ?? 'An unexpected error occurred.', error);
}

// ─── Password Validation ────────────────────────
export function validatePassword(password: string): PasswordValidation {
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;'/`~]/.test(password);
  
  const checks = [hasMinLength, hasUppercase, hasLowercase, hasNumber, hasSpecialChar];
  const passedChecks = checks.filter(Boolean).length;
  
  let strength: PasswordValidation['strength'] = 'weak';
  if (passedChecks >= 5) strength = 'strong';
  else if (passedChecks >= 4) strength = 'good';
  else if (passedChecks >= 3) strength = 'fair';
  
  return {
    isValid: hasMinLength && hasUppercase && hasNumber && hasSpecialChar,
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSpecialChar,
    strength,
  };
}

// ─── Username Validation ────────────────────────
function sanitizeUsername(username: string): string {
  return username.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function generateGlobalPayId(username: string): string {
  return `${sanitizeUsername(username)}@globalpay`;
}

// ─── Check Username Availability ────────────────
export async function checkUsernameAvailability(username: string): Promise<UsernameCheckResult> {
  try {
    const sanitized = sanitizeUsername(username);
    if (sanitized.length < 3) {
      return {
        available: false,
        error: createAuthError('UNKNOWN_ERROR', 'Username must be at least 3 characters.'),
      };
    }
    if (sanitized.length > 20) {
      return {
        available: false,
        error: createAuthError('UNKNOWN_ERROR', 'Username must be 20 characters or less.'),
      };
    }
    
    const globalPayId = generateGlobalPayId(sanitized);
    
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('global_pay_id', globalPayId)
      .maybeSingle();
    
    if (error) {
      __DEV__ && console.error('[AuthService] Username check error:', error);
      return { available: false, error: mapSupabaseError(error) };
    }
    
    return {
      available: !data,
      globalPayId: !data ? globalPayId : undefined,
    };
  } catch (e) {
    return { available: false, error: createAuthError('NETWORK_ERROR', 'Failed to check username availability.', e) };
  }
}

// ─── Create User Profile ────────────────────────
async function createUserProfile(
  userId: string,
  email: string,
  username: string,
  walletAddress: string,
  authProvider: 'email' | 'google' | 'apple' | 'phone',
  phone?: string,
): Promise<{ success: boolean; error?: AuthError }> {
  const globalPayId = generateGlobalPayId(username);
  
  try {
    // Small delay to ensure auth.users row is committed
    // This prevents the foreign key constraint error
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const { error: dbError } = await supabase
      .from('users')
      .insert({
        id: userId,
        email: email,
        display_name: username,
        global_pay_id: globalPayId,
        wallet_address: walletAddress,
      });
    
    if (dbError) {
      __DEV__ && console.error('[AuthService] Profile creation error:', dbError);
      
      // Handle duplicate key errors
      if (dbError.code === '23505') {
        if (dbError.message?.includes('global_pay_id')) {
          return {
            success: false,
            error: createAuthError('USERNAME_ALREADY_EXISTS', 'This username is already taken.'),
          };
        }
        if (dbError.message?.includes('wallet_address')) {
          return {
            success: false,
            error: createAuthError('UNKNOWN_ERROR', 'This wallet address is already registered.'),
          };
        }
      }
      
      // Handle foreign key error with retry
      if (dbError.code === '23503' || dbError.message?.includes('foreign key')) {
        __DEV__ && console.log('[AuthService] Foreign key error, retrying after delay...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const { error: retryError } = await supabase
          .from('users')
          .insert({
            id: userId,
            email: email,
            display_name: username,
            global_pay_id: globalPayId,
            wallet_address: walletAddress,
          });
        
        if (retryError) {
          return {
            success: false,
            error: createAuthError('PROFILE_CREATION_FAILED', 'Failed to create profile: ' + retryError.message),
          };
        }
        return { success: true };
      }
      
      return {
        success: false,
        error: createAuthError('PROFILE_CREATION_FAILED', 'Failed to create profile: ' + dbError.message),
      };
    }
    
    return { success: true };
  } catch (e: any) {
    return {
      success: false,
      error: createAuthError('PROFILE_CREATION_FAILED', e.message ?? 'Failed to create profile.', e),
    };
  }
}

// ─── Load User Profile ──────────────────────────
export async function loadUserProfile(
  userId: string,
  session: Session,
): Promise<{ user: AuthUser; session: Session } | null> {
  try {
    __DEV__ && console.log('[AuthService] Loading profile for userId:', userId);
    
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error || !data) {
      __DEV__ && console.log('[AuthService] No profile found:', error?.message);
      return null;
    }
    
    // Ensure wallet exists for this user
    await walletService.setActiveUser(data.id);
    let walletAddress = data.wallet_address ?? '';
    
    const localWallet = await walletService.getWalletAddress(data.id);
    if (!localWallet) {
      const created = await walletService.createWallet(data.id);
      walletAddress = created.address;
      
      if (!data.wallet_address || data.wallet_address.toLowerCase() !== created.address.toLowerCase()) {
        await supabase
          .from('users')
          .update({ wallet_address: created.address })
          .eq('id', data.id);
      }
    } else {
      walletAddress = localWallet;
    }
    
    const user: AuthUser = {
      id: data.id,
      email: data.email ?? session.user.email ?? '',
      phone: data.phone ?? session.user.phone,
      globalPayId: data.global_pay_id ?? '',
      displayName: data.display_name ?? '',
      avatarUrl: data.avatar_url,
      walletAddress,
      createdAt: data.created_at,
      emailVerified: session.user.email_confirmed_at != null,
      phoneVerified: session.user.phone_confirmed_at != null,
      authProvider: data.auth_provider ?? 'email',
    };
    
    __DEV__ && console.log('[AuthService] Profile loaded:', user.globalPayId);
    return { user, session };
  } catch (e: any) {
    __DEV__ && console.error('[AuthService] loadUserProfile error:', e.message);
    return null;
  }
}

// ─── Email/Password Sign Up ─────────────────────
export async function signUpWithEmail(data: SignUpData): Promise<SignUpResult> {
  try {
    // Validate password
    const passwordValidation = validatePassword(data.password);
    if (!passwordValidation.isValid) {
      return {
        success: false,
        error: createAuthError('WEAK_PASSWORD', 'Password must be at least 8 characters with uppercase, number, and special character.'),
      };
    }
    
    // Check username availability
    const usernameCheck = await checkUsernameAvailability(data.username);
    if (!usernameCheck.available) {
      return {
        success: false,
        error: usernameCheck.error ?? createAuthError('USERNAME_ALREADY_EXISTS', 'This username is already taken.'),
      };
    }
    
    // Create Supabase auth account
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          username: data.username,
        },
        // Skip email verification
        emailRedirectTo: undefined,
      },
    });
    
    if (authError) {
      return { success: false, error: mapSupabaseError(authError) };
    }
    if (!authData.user) {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Signup failed — no user returned.') };
    }
    
    // Detect if this email already exists (empty identities = existing user)
    const identities = authData.user.identities ?? [];
    if (identities.length === 0) {
      return {
        success: false,
        error: createAuthError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists. Please sign in instead.'),
      };
    }
    
    // Create wallet
    let walletAddress: string;
    try {
      const wallet = await walletService.createWallet(authData.user.id);
      walletAddress = wallet.address;
    } catch (walletErr: any) {
      __DEV__ && console.error('[AuthService] Wallet creation failed:', walletErr);
      return {
        success: false,
        error: createAuthError('WALLET_CREATION_FAILED', 'Failed to create wallet: ' + walletErr.message),
      };
    }
    
    // Create user profile immediately
    const profileResult = await createUserProfile(
      authData.user.id,
      data.email,
      data.username,
      walletAddress,
      'email',
    );
    
    if (!profileResult.success) {
      return { success: false, error: profileResult.error };
    }
    
    __DEV__ && console.log('[AuthService] Signup complete for', data.email);
    return { success: true };
  } catch (e: any) {
    __DEV__ && console.error('[AuthService] signUp error:', e);
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Signup failed.', e) };
  }
}

// ─── Email/Password Sign In ─────────────────────
export async function signInWithEmail(data: SignInData): Promise<SignInResult> {
  try {
    __DEV__ && console.log('[AuthService] signIn attempt for', data.email);
    
    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    });
    
    if (error) {
      return { success: false, error: mapSupabaseError(error) };
    }
    
    if (!authData.session) {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Sign in failed — no session.') };
    }
    
    __DEV__ && console.log('[AuthService] signIn success');
    return { success: true };
  } catch (e: any) {
    __DEV__ && console.error('[AuthService] signIn error:', e);
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Sign in failed.', e) };
  }
}

// ─── Google Sign In ─────────────────────────────
export async function signInWithGoogle(): Promise<SocialAuthResult> {
  try {
    // Check if social auth modules are available
    if (!AuthSession || !WebBrowser) {
      return {
        success: false,
        error: createAuthError('UNKNOWN_ERROR', 'Google Sign-In requires a custom development build. It is not available in Expo Go.'),
      };
    }

    // Get the redirect URL for Expo
    const redirectUrl = AuthSession.makeRedirectUri({
      scheme: 'globalpay',
      path: 'auth/callback',
    });
    
    __DEV__ && console.log('[AuthService] Google sign-in redirect URL:', redirectUrl);
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: true,
      },
    });
    
    if (error) {
      return { success: false, error: mapSupabaseError(error) };
    }
    
    if (!data.url) {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Failed to get Google auth URL.') };
    }
    
    // Open the browser for OAuth
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
    
    if (result.type !== 'success') {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Google sign-in was cancelled.') };
    }
    
    // Extract tokens from the URL
    const url = new URL(result.url);
    const accessToken = url.searchParams.get('access_token');
    const refreshToken = url.searchParams.get('refresh_token');
    
    if (!accessToken) {
      // Try hash params
      const hashParams = new URLSearchParams(url.hash.substring(1));
      const hashAccessToken = hashParams.get('access_token');
      const hashRefreshToken = hashParams.get('refresh_token');
      
      if (hashAccessToken) {
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: hashAccessToken,
          refresh_token: hashRefreshToken ?? '',
        });
        
        if (sessionError || !sessionData.session) {
          return { success: false, error: mapSupabaseError(sessionError) };
        }
        
        // Check if user has a profile
        const profile = await loadUserProfile(sessionData.session.user.id, sessionData.session);
        if (!profile) {
          return {
            success: true,
            needsUsername: true,
            tempUserId: sessionData.session.user.id,
            email: sessionData.session.user.email,
          };
        }
        
        return { success: true };
      }
      
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Failed to complete Google sign-in.') };
    }
    
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken ?? '',
    });
    
    if (sessionError || !sessionData.session) {
      return { success: false, error: mapSupabaseError(sessionError) };
    }
    
    // Check if user has a profile
    const profile = await loadUserProfile(sessionData.session.user.id, sessionData.session);
    if (!profile) {
      return {
        success: true,
        needsUsername: true,
        tempUserId: sessionData.session.user.id,
        email: sessionData.session.user.email,
      };
    }
    
    return { success: true };
  } catch (e: any) {
    __DEV__ && console.error('[AuthService] Google sign-in error:', e);
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Google sign-in failed.', e) };
  }
}

// ─── Apple Sign In ──────────────────────────────
export async function signInWithApple(): Promise<SocialAuthResult> {
  try {
    // Check if social auth modules are available
    if (!AppleAuthentication || !Crypto) {
      return {
        success: false,
        error: createAuthError('UNKNOWN_ERROR', 'Apple Sign-In requires a custom development build. It is not available in Expo Go.'),
      };
    }

    // Check if Apple auth is available
    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Apple Sign-In is not available on this device.') };
    }
    
    // Generate nonce for security
    const rawNonce = Array.from(
      await Crypto.getRandomBytesAsync(32),
      (byte: number) => byte.toString(16).padStart(2, '0'),
    ).join('');
    
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );
    
    // Request Apple credentials
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    
    if (!credential.identityToken) {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'No identity token received from Apple.') };
    }
    
    // Sign in with Supabase using the Apple token
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    
    if (error) {
      return { success: false, error: mapSupabaseError(error) };
    }
    
    if (!data.session) {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Apple sign-in failed — no session.') };
    }
    
    // Check if user has a profile
    const profile = await loadUserProfile(data.session.user.id, data.session);
    if (!profile) {
      return {
        success: true,
        needsUsername: true,
        tempUserId: data.session.user.id,
        email: data.session.user.email ?? credential.email,
      };
    }
    
    return { success: true };
  } catch (e: any) {
    if (e.code === 'ERR_REQUEST_CANCELED') {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Apple sign-in was cancelled.') };
    }
    __DEV__ && console.error('[AuthService] Apple sign-in error:', e);
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Apple sign-in failed.', e) };
  }
}

// ─── Complete Social Signup ─────────────────────
export async function completeSocialSignup(
  tempUserId: string,
  username: string,
): Promise<SignUpResult> {
  try {
    // Check username availability
    const usernameCheck = await checkUsernameAvailability(username);
    if (!usernameCheck.available) {
      return {
        success: false,
        error: usernameCheck.error ?? createAuthError('USERNAME_ALREADY_EXISTS', 'This username is already taken.'),
      };
    }
    
    // Get current session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || session.user.id !== tempUserId) {
      return { success: false, error: createAuthError('SESSION_EXPIRED', 'Session expired. Please try again.') };
    }
    
    // Create wallet
    let walletAddress: string;
    try {
      const wallet = await walletService.createWallet(tempUserId);
      walletAddress = wallet.address;
    } catch (walletErr: any) {
      return {
        success: false,
        error: createAuthError('WALLET_CREATION_FAILED', 'Failed to create wallet: ' + walletErr.message),
      };
    }
    
    // Determine auth provider
    const provider = session.user.app_metadata.provider as 'google' | 'apple' | 'email' | 'phone';
    
    // Create profile
    const profileResult = await createUserProfile(
      tempUserId,
      session.user.email ?? '',
      username,
      walletAddress,
      provider === 'google' || provider === 'apple' ? provider : 'email',
    );
    
    if (!profileResult.success) {
      return { success: false, error: profileResult.error };
    }
    
    __DEV__ && console.log('[AuthService] Social signup complete for', username);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Failed to complete signup.', e) };
  }
}

// ─── Send Phone OTP ─────────────────────────────
export async function sendPhoneOTP(data: PhoneAuthData): Promise<PhoneAuthResult> {
  try {
    const fullPhone = `${data.countryCode}${data.phone.replace(/\D/g, '')}`;
    
    const { error } = await supabase.auth.signInWithOtp({
      phone: fullPhone,
    });
    
    if (error) {
      return { success: false, error: mapSupabaseError(error) };
    }
    
    __DEV__ && console.log('[AuthService] OTP sent to', fullPhone);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Failed to send OTP.', e) };
  }
}

// ─── Verify Phone OTP ───────────────────────────
export async function verifyPhoneOTP(data: VerifyOTPData): Promise<VerifyOTPResult> {
  try {
    const { data: authData, error } = await supabase.auth.verifyOtp({
      phone: data.phone,
      token: data.otp,
      type: 'sms',
    });
    
    if (error) {
      if (error.message.includes('expired')) {
        return { success: false, error: createAuthError('OTP_EXPIRED', 'OTP has expired. Please request a new one.') };
      }
      if (error.message.includes('invalid')) {
        return { success: false, error: createAuthError('INVALID_OTP', 'Invalid OTP. Please try again.') };
      }
      return { success: false, error: mapSupabaseError(error) };
    }
    
    if (!authData.session) {
      return { success: false, error: createAuthError('UNKNOWN_ERROR', 'Verification failed — no session.') };
    }
    
    // Check if user has a profile
    const profile = await loadUserProfile(authData.session.user.id, authData.session);
    if (!profile) {
      return { success: true, needsUsername: true, isNewUser: true };
    }
    
    return { success: true, isNewUser: false };
  } catch (e: any) {
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'OTP verification failed.', e) };
  }
}

// ─── Complete Phone Signup ──────────────────────
export async function completePhoneSignup(username: string): Promise<SignUpResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { success: false, error: createAuthError('SESSION_EXPIRED', 'Session expired. Please try again.') };
    }
    
    // Check username availability
    const usernameCheck = await checkUsernameAvailability(username);
    if (!usernameCheck.available) {
      return {
        success: false,
        error: usernameCheck.error ?? createAuthError('USERNAME_ALREADY_EXISTS', 'This username is already taken.'),
      };
    }
    
    // Create wallet
    let walletAddress: string;
    try {
      const wallet = await walletService.createWallet(session.user.id);
      walletAddress = wallet.address;
    } catch (walletErr: any) {
      return {
        success: false,
        error: createAuthError('WALLET_CREATION_FAILED', 'Failed to create wallet: ' + walletErr.message),
      };
    }
    
    // Create profile
    const profileResult = await createUserProfile(
      session.user.id,
      session.user.email ?? '',
      username,
      walletAddress,
      'phone',
      session.user.phone,
    );
    
    if (!profileResult.success) {
      return { success: false, error: profileResult.error };
    }
    
    __DEV__ && console.log('[AuthService] Phone signup complete for', username);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Failed to complete signup.', e) };
  }
}

// ─── Password Reset Request ─────────────────────
export async function resetPassword(email: string): Promise<ResetPasswordResult> {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'globalpay://reset-password',
    });
    
    if (error) {
      return { success: false, error: mapSupabaseError(error) };
    }
    
    __DEV__ && console.log('[AuthService] Password reset email sent to', email);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Failed to send reset email.', e) };
  }
}

// ─── Confirm Password Reset ─────────────────────
export async function confirmResetPassword(data: ConfirmResetPasswordData): Promise<ResetPasswordResult> {
  try {
    // Validate new password
    const validation = validatePassword(data.newPassword);
    if (!validation.isValid) {
      return {
        success: false,
        error: createAuthError('WEAK_PASSWORD', 'Password must be at least 8 characters with uppercase, number, and special character.'),
      };
    }
    
    const { error } = await supabase.auth.updateUser({
      password: data.newPassword,
    });
    
    if (error) {
      return { success: false, error: mapSupabaseError(error) };
    }
    
    __DEV__ && console.log('[AuthService] Password reset complete');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Failed to reset password.', e) };
  }
}

// ─── Resend Verification Email ──────────────────
export async function resendVerificationEmail(email: string): Promise<{ error?: AuthError }> {
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    
    if (error) {
      return { error: mapSupabaseError(error) };
    }
    
    return {};
  } catch (e: any) {
    return { error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Failed to resend verification email.', e) };
  }
}

// ─── Change Email ───────────────────────────────
export async function changeEmail(data: ChangeEmailData): Promise<ChangeEmailResult> {
  try {
    // Verify current password first
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { success: false, error: createAuthError('SESSION_EXPIRED', 'Please sign in again.') };
    }
    
    // Re-authenticate with password
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: session.user.email!,
      password: data.password,
    });
    
    if (authError) {
      return { success: false, error: createAuthError('INVALID_CREDENTIALS', 'Incorrect password.') };
    }
    
    // Update email
    const { error } = await supabase.auth.updateUser({
      email: data.newEmail,
    });
    
    if (error) {
      return { success: false, error: mapSupabaseError(error) };
    }
    
    return { success: true, verificationRequired: true };
  } catch (e: any) {
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Failed to change email.', e) };
  }
}

// ─── Delete Account ─────────────────────────────
export async function deleteAccount(password: string): Promise<DeleteAccountResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return { success: false, error: createAuthError('SESSION_EXPIRED', 'Please sign in again.') };
    }
    
    // Verify password
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: session.user.email!,
      password,
    });
    
    if (authError) {
      return { success: false, error: createAuthError('INVALID_CREDENTIALS', 'Incorrect password.') };
    }
    
    const userId = session.user.id;
    
    // Delete user data from our database
    // This should cascade to related tables via foreign keys
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);
    
    if (deleteError) {
      __DEV__ && console.error('[AuthService] Delete user data error:', deleteError);
    }
    
    // Clear local wallet
    try {
      await walletService.clearActiveUser();
    } catch (e) {
      __DEV__ && console.warn('[AuthService] Failed to clear wallet:', e);
    }
    
    // Sign out
    await supabase.auth.signOut();
    
    __DEV__ && console.log('[AuthService] Account deleted');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: createAuthError('UNKNOWN_ERROR', e.message ?? 'Failed to delete account.', e) };
  }
}

// ─── Sign Out ───────────────────────────────────
export async function signOut(): Promise<void> {
  try {
    await walletService.clearActiveUser();
  } catch (e) {
    __DEV__ && console.warn('[AuthService] Failed to clear wallet on signout:', e);
  }
  await supabase.auth.signOut();
}

// ─── Export Service ─────────────────────────────
export const authService = {
  validatePassword,
  checkUsernameAvailability,
  loadUserProfile,
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signInWithApple,
  completeSocialSignup,
  sendPhoneOTP,
  verifyPhoneOTP,
  completePhoneSignup,
  resetPassword,
  confirmResetPassword,
  resendVerificationEmail,
  changeEmail,
  deleteAccount,
  signOut,
};
