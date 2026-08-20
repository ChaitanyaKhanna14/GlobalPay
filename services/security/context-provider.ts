/**
 * Collects the contextual signals attached to real security events.
 *
 * ── Privacy stance ──
 * The device identifier is a random UUID generated once and stored locally. It
 * is deliberately *not* derived from a hardware serial, IMEI, advertising ID, or
 * any other stable hardware identifier: those follow a person across apps and
 * cannot be reset. This one is pseudonymous, scoped to this install, and
 * disappears when the app's data is cleared — which is all the risk engine
 * needs in order to answer "have I seen this device before?".
 *
 * Location is likewise coarse by construction. We never request GPS permission.
 * In production the city/country would be resolved server-side from the request
 * IP, which is why those fields are left undefined here rather than guessed:
 * a risk engine fed fabricated geodata is worse than one fed none.
 */
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { EventContext } from '@/types/security';

const DEVICE_ID_KEY = 'globalpay_device_id';

let cachedDeviceId: string | null = null;

function randomId(): string {
  // Not used for anything security-critical — this is a correlation handle, not
  // a secret — so Math.random is adequate and avoids a native crypto dependency
  // in a module that runs on every event.
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Stable pseudonymous identifier for this install. */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
    const fresh = randomId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
    cachedDeviceId = fresh;
    return fresh;
  } catch {
    // Storage unavailable — fall back to a per-session id rather than failing
    // the event that wanted to be logged.
    cachedDeviceId ??= randomId();
    return cachedDeviceId;
  }
}

/** Human-readable device label for the SOC feed. */
export function getDeviceName(): string {
  if (Platform.OS === 'web') return 'Web browser';
  const name = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ').trim();
  return name || `${Platform.OS} device`;
}

/**
 * Base context for a real (non-simulated) event.
 *
 * Note what is absent: no IP address, no city, no coordinates. Those are
 * attributes of the *request*, and only the server sees the true source IP — a
 * client-reported one is attacker-controlled and worthless for risk scoring.
 * When event forwarding moves server-side, the Edge Function enriches these
 * fields from the request metadata.
 */
export async function baseContext(extra: EventContext = {}): Promise<EventContext> {
  return {
    deviceId: await getDeviceId(),
    deviceName: getDeviceName(),
    ...extra,
  };
}
