/**
 * Forwards security events to Supabase so one SOC can monitor a fleet.
 *
 * ── Why local stays the source of truth ──
 * The device keeps writing its hash chain locally, and this module mirrors
 * events upward. It is deliberately not the other way round.
 *
 * The chain's integrity guarantee comes from each event committing to its
 * predecessor. If the server assigned ordering, two devices appending
 * concurrently would interleave into a single chain and every verification
 * would depend on network round-trips — a dropped request would look identical
 * to tampering. Keeping the chain device-local means each device can prove its
 * own log unaided and offline, and the server holds a *replica* for fleet
 * visibility rather than the authority.
 *
 * So: local = integrity, Supabase = visibility. The tamper demo still works
 * with the network unplugged.
 *
 * ── Failure posture ──
 * Every function here swallows its errors. Security telemetry is secondary to
 * the user's actual task: a failed sync must never break a payment or a login.
 * Unsent events are queued and retried on the next flush, so an offline device
 * catches up rather than losing history.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/supabase';
import type { SecurityEvent } from '@/types/security';

const PENDING_KEY = 'globalpay_security_sync_pending';

/** Column shape of public.security_events. */
interface EventRow {
  id: string;
  type: string;
  category: string;
  severity: string;
  occurred_at: string;
  user_id: string | null;
  actor: string | null;
  device_id: string | null;
  device_name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  ip_address: string | null;
  ip_reputation_flagged: boolean;
  amount_usd: number | null;
  token: string | null;
  counterparty: string | null;
  detail: string | null;
  simulated: boolean;
  prev_hash: string;
  hash: string;
}

/** A UUID column cannot take the simulator's synthetic ids. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRow(event: SecurityEvent): EventRow {
  const c = event.context;
  return {
    id: event.id,
    type: event.type,
    category: event.category,
    severity: event.severity,
    occurred_at: event.timestamp,
    // `demo-user` and similar placeholders are not UUIDs; send null rather than
    // letting Postgres reject the whole batch.
    user_id: UUID_RE.test(event.userId) ? event.userId : null,
    actor: event.actor ?? null,
    device_id: c.deviceId ?? null,
    device_name: c.deviceName ?? null,
    city: c.city ?? null,
    country: c.country ?? null,
    lat: c.lat ?? null,
    lon: c.lon ?? null,
    ip_address: c.ipAddress ?? null,
    ip_reputation_flagged: !!c.ipReputationFlagged,
    amount_usd: c.amountUsd ?? null,
    token: c.token ?? null,
    counterparty: c.counterparty ?? null,
    detail: c.detail ?? null,
    simulated: !!c.simulated,
    prev_hash: event.prevHash,
    hash: event.hash,
  };
}

// ─── Pending queue ──────────────────────────────

async function readPending(): Promise<SecurityEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as SecurityEvent[]) : [];
  } catch {
    return [];
  }
}

async function writePending(events: SecurityEvent[]): Promise<void> {
  try {
    // Cap the backlog. An indefinitely offline device should not grow this
    // without bound; the local chain remains complete either way.
    const capped = events.slice(-500);
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(capped));
  } catch {
    /* best effort */
  }
}

// ─── Sync ───────────────────────────────────────

let flushing = false;

/**
 * Push queued events to Supabase.
 *
 * Uses upsert with ignoreDuplicates so a retry after a partial failure cannot
 * violate the primary key — the table is append-only at the trigger level, so
 * an ordinary upsert that attempted an UPDATE would be rejected outright.
 */
export async function flushPending(): Promise<{ sent: number; queued: number }> {
  if (flushing) return { sent: 0, queued: (await readPending()).length };
  flushing = true;
  try {
    const pending = await readPending();
    if (pending.length === 0) return { sent: 0, queued: 0 };

    // Without a session the insert would fail the RLS check anyway.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { sent: 0, queued: pending.length };

    const rows = pending.map(toRow);
    const { error } = await supabase
      .from('security_events')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });

    if (error) {
      __DEV__ && console.warn('[EventSync] Upload failed, keeping queue:', error.message);
      return { sent: 0, queued: pending.length };
    }

    await writePending([]);
    __DEV__ && console.log(`[EventSync] Synced ${rows.length} event(s)`);
    return { sent: rows.length, queued: 0 };
  } catch (e) {
    __DEV__ && console.warn('[EventSync] Flush error:', e);
    return { sent: 0, queued: -1 };
  } finally {
    flushing = false;
  }
}

/** Queue events for upload, then attempt an immediate flush. */
export async function enqueue(events: SecurityEvent[]): Promise<void> {
  if (events.length === 0) return;
  try {
    const pending = await readPending();
    await writePending([...pending, ...events]);
    void flushPending();
  } catch (e) {
    __DEV__ && console.warn('[EventSync] Enqueue failed:', e);
  }
}

// ─── Fleet read ─────────────────────────────────

/**
 * Read events from Supabase.
 *
 * What comes back is decided entirely by RLS: an ordinary account sees only
 * its own rows, an account listed in `soc_analysts` sees the fleet. The client
 * does not choose — which is the point. A permission model the client can talk
 * its way past is not a permission model.
 */
export async function fetchFleetEvents(limit = 250): Promise<SecurityEvent[]> {
  try {
    const { data, error } = await supabase
      .from('security_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      __DEV__ && error && console.warn('[EventSync] Fleet fetch failed:', error.message);
      return [];
    }

    return (data as EventRow[]).map(fromRow);
  } catch (e) {
    __DEV__ && console.warn('[EventSync] Fleet fetch error:', e);
    return [];
  }
}

function fromRow(row: EventRow): SecurityEvent {
  return {
    id: row.id,
    type: row.type as SecurityEvent['type'],
    category: row.category as SecurityEvent['category'],
    severity: row.severity as SecurityEvent['severity'],
    timestamp: row.occurred_at,
    userId: row.user_id ?? 'unknown',
    actor: row.actor ?? undefined,
    context: {
      deviceId: row.device_id ?? undefined,
      deviceName: row.device_name ?? undefined,
      city: row.city ?? undefined,
      country: row.country ?? undefined,
      lat: row.lat ?? undefined,
      lon: row.lon ?? undefined,
      ipAddress: row.ip_address ?? undefined,
      ipReputationFlagged: row.ip_reputation_flagged,
      amountUsd: row.amount_usd ?? undefined,
      token: row.token ?? undefined,
      counterparty: row.counterparty ?? undefined,
      detail: row.detail ?? undefined,
      simulated: row.simulated,
    },
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

/** Whether this account is on the analyst roster (i.e. gets the fleet view). */
export async function isAnalyst(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('is_soc_analyst');
    return !error && data === true;
  } catch {
    return false;
  }
}
