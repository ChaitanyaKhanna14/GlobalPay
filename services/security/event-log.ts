/**
 * Append-only, hash-chained security event log.
 *
 * Every event stores the hash of the event before it, so the log forms a chain:
 *
 *   e0.hash = H(e0.payload ‖ GENESIS)
 *   e1.hash = H(e1.payload ‖ e0.hash)
 *   e2.hash = H(e2.payload ‖ e1.hash)
 *
 * Editing or deleting any event changes its hash, which breaks every link after
 * it. That makes tampering *detectable* locally — and once the chain head is
 * anchored on Polygon (see blockchain-anchor.ts) it becomes detectable even if
 * an attacker controls the entire database, because they cannot rewrite the
 * chain.
 *
 * Hashing uses keccak256 from ethers: it is pure JS (identical on web, iOS and
 * Android), synchronous, and the same primitive the EVM uses — so the digests
 * we anchor are natively meaningful on-chain.
 */
import { keccak256, toUtf8Bytes } from 'ethers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  categoryOf,
  type EventContext,
  type SecurityEvent,
  type SecurityEventType,
  type Severity,
} from '@/types/security';

const STORAGE_KEY = 'globalpay_security_events';
/** Chain root. Anything before this does not exist. */
export const GENESIS_HASH = '0x' + '0'.repeat(64);
/** Cap the local log so a long demo session cannot exhaust storage. */
const MAX_EVENTS = 2000;

/** Default severity per event type. Detection rules may escalate an alert later. */
const DEFAULT_SEVERITY: Partial<Record<SecurityEventType, Severity>> = {
  'auth.login.failure': 'low',
  'auth.mfa.failure': 'medium',
  'auth.password.change': 'medium',
  'auth.password.reset_request': 'low',
  'device.new': 'medium',
  'session.hijack_suspected': 'critical',
  'pin.failure': 'low',
  'pin.lockout': 'high',
  'biometric.failure': 'low',
  'payment.blocked': 'high',
  'payment.challenged': 'medium',
  'payment.failed': 'low',
  'wallet.key_exported': 'high',
  'account.email_change': 'medium',
  'account.deleted': 'high',
  'appsec.injection_attempt': 'critical',
  'appsec.rate_limit_exceeded': 'medium',
  'appsec.malformed_request': 'low',
};

/**
 * Canonical serialisation of the parts of an event that are covered by its
 * hash. Key order is fixed and explicit — JSON.stringify over an object would
 * make the digest depend on property insertion order, which would silently
 * break verification across platforms.
 */
function canonicalPayload(
  event: Omit<SecurityEvent, 'hash' | 'prevHash'>,
  prevHash: string,
): string {
  const c = event.context;
  return [
    event.id,
    event.type,
    event.severity,
    event.timestamp,
    event.userId,
    event.actor ?? '',
    c.deviceId ?? '',
    c.city ?? '',
    c.country ?? '',
    c.ipAddress ?? '',
    c.amountUsd ?? '',
    c.token ?? '',
    c.counterparty ?? '',
    c.detail ?? '',
    prevHash,
  ].join('|');
}

/** Hash one event against its predecessor. Exported so verification can re-derive it. */
export function hashEvent(
  event: Omit<SecurityEvent, 'hash' | 'prevHash'>,
  prevHash: string,
): string {
  return keccak256(toUtf8Bytes(canonicalPayload(event, prevHash)));
}

function newId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── In-memory cache ────────────────────────────
// The SOC dashboard reads this on every render, so we keep the chain in memory
// and treat AsyncStorage as the durable mirror.
let cache: SecurityEvent[] | null = null;
let loading: Promise<SecurityEvent[]> | null = null;

type Listener = (events: SecurityEvent[]) => void;
const listeners = new Set<Listener>();

function emit(events: SecurityEvent[]) {
  listeners.forEach((fn) => {
    try {
      fn(events);
    } catch {
      /* a broken subscriber must not break the log */
    }
  });
}

/** Subscribe to log changes. Returns an unsubscribe function. */
export function subscribeToEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function persist(events: SecurityEvent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch (e) {
    __DEV__ && console.warn('[EventLog] Failed to persist events:', e);
  }
}

/** Load the chain from storage (memoised). */
export async function loadEvents(): Promise<SecurityEvent[]> {
  if (cache) return cache;
  if (loading) return loading;

  loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      cache = raw ? (JSON.parse(raw) as SecurityEvent[]) : [];
    } catch (e) {
      __DEV__ && console.warn('[EventLog] Failed to load events, starting fresh:', e);
      cache = [];
    }
    loading = null;
    return cache;
  })();

  return loading;
}

/** Read the current chain synchronously. Returns [] before the first load resolves. */
export function getEventsSync(): SecurityEvent[] {
  return cache ?? [];
}

/** Hash of the most recent event, or GENESIS when the log is empty. */
export function chainHead(events: SecurityEvent[] = getEventsSync()): string {
  return events.length ? events[events.length - 1].hash : GENESIS_HASH;
}

export interface RecordEventInput {
  type: SecurityEventType;
  userId: string;
  actor?: string;
  context?: EventContext;
  /** Override the default severity for this event type. */
  severity?: Severity;
  /** Override the timestamp — used by the attack simulator to backdate events. */
  timestamp?: string;
}

/**
 * Append an event to the chain. This is the single entry point for the whole
 * app; nothing else may write to the log.
 */
export async function recordEvent(input: RecordEventInput): Promise<SecurityEvent> {
  const events = await loadEvents();

  const base: Omit<SecurityEvent, 'hash' | 'prevHash'> = {
    id: newId(),
    type: input.type,
    category: categoryOf(input.type),
    severity: input.severity ?? DEFAULT_SEVERITY[input.type] ?? 'info',
    timestamp: input.timestamp ?? new Date().toISOString(),
    userId: input.userId,
    actor: input.actor,
    context: input.context ?? {},
  };

  const prevHash = chainHead(events);
  const event: SecurityEvent = {
    ...base,
    prevHash,
    hash: hashEvent(base, prevHash),
  };

  events.push(event);

  // Trim from the front if we exceed the cap. Note this necessarily breaks the
  // chain's link to genesis; verifyChain() therefore validates links *between
  // retained events* rather than back to the root.
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  cache = events;
  await persist(events);
  emit(events);
  return event;
}

/** Append many events efficiently (one persist, one notification). */
export async function recordEvents(inputs: RecordEventInput[]): Promise<SecurityEvent[]> {
  const events = await loadEvents();
  const created: SecurityEvent[] = [];

  for (const input of inputs) {
    const base: Omit<SecurityEvent, 'hash' | 'prevHash'> = {
      id: newId(),
      type: input.type,
      category: categoryOf(input.type),
      severity: input.severity ?? DEFAULT_SEVERITY[input.type] ?? 'info',
      timestamp: input.timestamp ?? new Date().toISOString(),
      userId: input.userId,
      actor: input.actor,
      context: input.context ?? {},
    };
    const prevHash = chainHead(events);
    const event: SecurityEvent = { ...base, prevHash, hash: hashEvent(base, prevHash) };
    events.push(event);
    created.push(event);
  }

  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }

  cache = events;
  await persist(events);
  emit(events);
  return created;
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  brokenAtIndex?: number;
  brokenEventId?: string;
}

/**
 * Recompute every hash and confirm each event still commits to its predecessor.
 * This is the local half of integrity checking; the blockchain anchor supplies
 * the other half (proving the chain head itself was not rewritten).
 */
export function verifyChain(events: SecurityEvent[] = getEventsSync()): ChainVerification {
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    // Links are checked between retained events; the oldest retained event may
    // legitimately point at a trimmed predecessor.
    if (i > 0 && event.prevHash !== events[i - 1].hash) {
      return { valid: false, checked: events.length, brokenAtIndex: i, brokenEventId: event.id };
    }

    const { hash, prevHash, ...base } = event;
    if (hashEvent(base, prevHash) !== hash) {
      return { valid: false, checked: events.length, brokenAtIndex: i, brokenEventId: event.id };
    }
  }
  return { valid: true, checked: events.length };
}

/** Wipe the log. Development and demo-reset only. */
export async function clearEvents(): Promise<void> {
  cache = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
  emit(cache);
}
