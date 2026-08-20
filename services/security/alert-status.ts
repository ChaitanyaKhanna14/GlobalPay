/**
 * Analyst triage state for alerts.
 *
 * Alerts are *derived* — they are recomputed from the event log on every read
 * rather than stored — so triage state cannot live on the alert itself; it
 * would be discarded on the next recomputation. It is therefore kept in a
 * separate store keyed by alert id.
 *
 * This is exactly why `detection-rules.ts` derives alert ids from the rule plus
 * its first piece of evidence instead of randomising them: a random id would
 * change identity on every pass and orphan the triage record attached to it.
 *
 * Keeping the two apart has a second benefit. The evidence stays immutable and
 * hash-chained, while the human judgement about it stays mutable — an analyst
 * marking something a false positive must never be able to alter the events
 * that produced it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AlertStatus } from '@/types/security';

const STORAGE_KEY = 'globalpay_alert_triage';

export interface TriageRecord {
  status: AlertStatus;
  note?: string;
  updatedAt: string;
  /** Who made the call. Populated once a real analyst identity exists. */
  updatedBy?: string;
}

type TriageMap = Record<string, TriageRecord>;

let cache: TriageMap | null = null;

type Listener = (map: TriageMap) => void;
const listeners = new Set<Listener>();

export function subscribeToTriage(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(map: TriageMap) {
  listeners.forEach((fn) => {
    try {
      fn(map);
    } catch {
      /* a broken subscriber must not break triage */
    }
  });
}

export async function loadTriage(): Promise<TriageMap> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as TriageMap) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Read the triage map synchronously. Empty before the first load resolves. */
export function getTriageSync(): TriageMap {
  return cache ?? {};
}

export function statusFor(alertId: string): AlertStatus {
  return getTriageSync()[alertId]?.status ?? 'open';
}

export function triageFor(alertId: string): TriageRecord | undefined {
  return getTriageSync()[alertId];
}

/** Record an analyst decision about an alert. */
export async function setAlertStatus(
  alertId: string,
  status: AlertStatus,
  note?: string,
  updatedBy?: string,
): Promise<void> {
  const map = await loadTriage();
  map[alertId] = {
    status,
    note: note ?? map[alertId]?.note,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  cache = map;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    __DEV__ && console.warn('[Triage] Failed to persist alert status:', e);
  }
  emit(map);
}

/**
 * Statuses an analyst may move an alert to from its current one.
 *
 * Transitions are constrained rather than free-form so the workflow reflects
 * how triage actually proceeds: an alert is acknowledged before it is closed,
 * and a closed alert is reopened explicitly rather than edited in place.
 */
export function allowedTransitions(current: AlertStatus): AlertStatus[] {
  switch (current) {
    case 'open':
      return ['investigating', 'false_positive'];
    case 'investigating':
      return ['contained', 'resolved', 'false_positive'];
    case 'contained':
      return ['resolved', 'investigating'];
    case 'resolved':
    case 'false_positive':
      return ['open'];
  }
}

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  contained: 'Contained',
  resolved: 'Resolved',
  false_positive: 'False positive',
};

/** Statuses that still demand attention — drives the "open alerts" metric. */
export function isActive(status: AlertStatus): boolean {
  return status === 'open' || status === 'investigating' || status === 'contained';
}

export async function clearTriage(): Promise<void> {
  cache = {};
  await AsyncStorage.removeItem(STORAGE_KEY);
  emit(cache);
}
