/**
 * Platform-aware secure storage.
 *
 * On native (iOS/Android) this delegates to expo-secure-store, which is backed
 * by the iOS Keychain and Android Keystore — hardware-isolated where available.
 *
 * expo-secure-store ships no web implementation, so on web every call throws
 * (`ExpoSecureStore.default.getValueWithKeyAsync is not a function`). Because the
 * web target exists for development and for the SOC dashboard demo — not for
 * custody of real funds — we fall back to localStorage there and warn loudly.
 *
 * SECURITY NOTE: localStorage is readable by any script on the origin and is NOT
 * a safe home for private keys. Treat the web build as a demo/analyst surface
 * only. Real wallet custody must happen on native, where hardware-backed
 * storage is available.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const WEB_PREFIX = 'globalpay_insecure_';
const isWeb = Platform.OS === 'web';

let warned = false;
function warnOnce() {
  if (warned || !__DEV__) return;
  warned = true;
  console.warn(
    '[SecureStorage] Running on web — secrets fall back to localStorage, which is NOT hardware-backed. ' +
      'Use the native build for real wallet custody.',
  );
}

function memoryOrLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export async function getSecureItem(key: string): Promise<string | null> {
  if (isWeb) {
    warnOnce();
    return memoryOrLocalStorage()?.getItem(WEB_PREFIX + key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    warnOnce();
    memoryOrLocalStorage()?.setItem(WEB_PREFIX + key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (isWeb) {
    warnOnce();
    memoryOrLocalStorage()?.removeItem(WEB_PREFIX + key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

// ─── expo-secure-store compatible aliases ───────
// These let existing call sites keep their `SecureStore.getItemAsync(...)`
// shape, so adopting this module is a one-line import change per file.
export const getItemAsync = getSecureItem;
export const setItemAsync = setSecureItem;
export const deleteItemAsync = deleteSecureItem;
