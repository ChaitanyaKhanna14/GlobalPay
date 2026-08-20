import { defineConfig } from 'vitest/config';
import path from 'node:path';


/**
 * Vitest runs the security layer's pure logic in plain Node — no Metro, no
 * simulator, no device. That is possible because the risk engine, detection
 * rules, and Merkle code were written free of React and native dependencies.
 *
 * The two modules that do touch platform APIs (AsyncStorage for persistence,
 * react-native's Platform) are aliased to lightweight in-memory stubs below, so
 * the hash-chain and anchoring logic can still be exercised end to end.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: [
      {
        find: '@react-native-async-storage/async-storage',
        replacement: path.resolve(import.meta.dirname, 'tests/stubs/async-storage.ts'),
      },
      {
        find: 'react-native',
        replacement: path.resolve(import.meta.dirname, 'tests/stubs/react-native.ts'),
      },
      // Must precede the generic '@' alias, or '@/supabase' resolves to the
      // real client and throws on missing env vars.
      {
        find: '@/supabase',
        replacement: path.resolve(import.meta.dirname, 'tests/stubs/supabase.ts'),
      },
      { find: '@', replacement: path.resolve(import.meta.dirname, '.') },
    ],
  },
});
