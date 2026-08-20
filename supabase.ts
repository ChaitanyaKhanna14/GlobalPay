import { Platform } from 'react-native';
import { createClient, processLock } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase environment variables. Check your .env file for EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

/**
 * Expo web builds are server-rendered (app.config.ts sets web.output: 'static'),
 * so this module is first evaluated in Node where `window` does not exist.
 * AsyncStorage reaches for window.localStorage on import-time reads and throws,
 * which kills the render. During SSR we hand Supabase an inert no-op store —
 * there is no session to restore on the server anyway — and switch to the real
 * AsyncStorage once we are running in a browser or on native.
 */
const isServerRender = Platform.OS === 'web' && typeof window === 'undefined';

const noopStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: isServerRender ? noopStorage : AsyncStorage,
    autoRefreshToken: !isServerRender,
    persistSession: !isServerRender,
    detectSessionInUrl: false,
    /**
     * Serialise auth calls within this JS context instead of across browser tabs.
     *
     * supabase-js defaults to `navigatorLock`, which uses the Web Locks API to
     * coordinate token refresh between tabs of the same origin. That default is
     * wrong for us twice over. On React Native `navigator.locks` does not exist
     * at all. And on web it actively breaks the app: whichever tab acquires the
     * lock holds it, so every *other* tab's `getSession()` rejects with
     * "AbortError: signal is aborted without reason". AuthProvider catches that,
     * leaves `isAuthenticated` false, and the router sends a fully signed-in
     * user to the login screen — while the first tab keeps working, which makes
     * the failure look like a client-side fluke rather than a bug.
     *
     * `processLock` gives the same mutual exclusion via an in-memory promise
     * chain, scoped to one JS context. Each tab then manages its own session
     * copy, which is correct here because the session is persisted to storage
     * and re-read on load anyway.
     */
    lock: processLock,
  },
});
