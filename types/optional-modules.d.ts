/**
 * Ambient declarations for optional native modules.
 *
 * `expo-apple-authentication` and `expo-auth-session` are intentionally NOT
 * listed in package.json — social login only works in a custom dev build, and
 * services/auth-service.ts loads them via guarded dynamic import so the app
 * still runs in Expo Go. These stubs keep `tsc --noEmit` clean without
 * pretending the packages are installed.
 */
declare module 'expo-apple-authentication' {
  const AppleAuthentication: any;
  export = AppleAuthentication;
}

declare module 'expo-auth-session' {
  const AuthSession: any;
  export = AuthSession;
}
