/**
 * Polyfills required for ethers.js on React Native
 * MUST be imported at the very top of the app entry (_layout.tsx) before any other imports
 */
import { getRandomValues as expoGetRandomValues } from 'expo-crypto';

// Polyfill globalThis.crypto.getRandomValues for ethers.js wallet generation
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {};
}

if (typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto.getRandomValues = expoGetRandomValues as any;
}
