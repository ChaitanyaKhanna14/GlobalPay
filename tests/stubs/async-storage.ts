/**
 * In-memory stand-in for @react-native-async-storage/async-storage.
 *
 * The event log's durability behaviour is part of what we want to test, so the
 * stub implements real get/set/remove semantics rather than no-ops.
 */
const store = new Map<string, string>();

const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    return store.has(key) ? store.get(key)! : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
  async clear(): Promise<void> {
    store.clear();
  },
  /** Test-only helper for resetting between cases. */
  __reset(): void {
    store.clear();
  },
};

export default AsyncStorage;
