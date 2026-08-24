/**
 * Regression tests for the sync queue's drain semantics.
 *
 * The bug these were written for: `flushPending` snapshotted the queue, sent
 * it, then cleared the queue *wholesale*. Anything appended while the upload
 * was in flight was erased without ever being sent — and `enqueue` could not
 * start a second flush to rescue it, because a flush was already marked in
 * progress.
 *
 * It surfaced on real hardware. Signing in on a phone fires several events
 * within a few hundred milliseconds; the first reached Postgres and the login
 * event did not. Nothing looked wrong from the device, because the local hash
 * chain — the source of truth for integrity — had every event. Only fleet
 * visibility silently lost them, which is the failure mode a SOC can least
 * afford to have in its own plumbing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushPending, PENDING_KEY } from '@/services/security/event-sync';
import { configureSupabaseStub, supabaseStub } from '../tests/stubs/supabase';
import type { SecurityEvent } from '@/types/security';

function event(id: string): SecurityEvent {
  return {
    id,
    type: 'auth.login.success',
    category: 'authentication',
    severity: 'info',
    timestamp: '2026-08-24T11:51:10.000Z',
    userId: '77f29ff4-b75d-42de-bc5b-89d2af51a1c3',
    actor: 'nehan@globalpay',
    context: {},
    prevHash: '0x' + '0'.repeat(64),
    hash: '0x' + id.padStart(64, '0'),
  } as SecurityEvent;
}

async function seedQueue(events: SecurityEvent[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(events));
}

async function readQueue(): Promise<SecurityEvent[]> {
  const raw = await AsyncStorage.getItem(PENDING_KEY);
  return raw ? JSON.parse(raw) : [];
}

/** Every id handed to upsert across all passes. */
function sentIds(): string[] {
  return supabaseStub.upserted.flat().map((row) => row.id as string);
}

describe('flushPending', () => {
  beforeEach(async () => {
    (AsyncStorage as unknown as { __reset(): void }).__reset();
    configureSupabaseStub({ session: { user: { id: 'u1' } } });
  });

  it('sends the queue and empties it', async () => {
    await seedQueue([event('a'), event('b')]);

    const result = await flushPending();

    expect(result).toEqual({ sent: 2, queued: 0 });
    expect(sentIds()).toEqual(['a', 'b']);
    expect(await readQueue()).toEqual([]);
  });

  it('does not discard events appended while an upload is in flight', async () => {
    await seedQueue([event('a')]);

    // Land a concurrent append inside the upload window — deterministically,
    // rather than racing a timer. This is what signing in actually does.
    configureSupabaseStub({
      session: { user: { id: 'u1' } },
      onUpsert: async (rows) => {
        if (rows.length === 1 && rows[0].id === 'a') {
          await seedQueue([...(await readQueue()), event('b')]);
        }
      },
    });

    const result = await flushPending();

    // 'b' must reach the server, not vanish with the cleared queue.
    expect(sentIds()).toContain('b');
    expect(result.sent).toBe(2);
    expect(result.queued).toBe(0);
    expect(await readQueue()).toEqual([]);
  });

  it('keeps the queue intact when the upload fails', async () => {
    await seedQueue([event('a'), event('b')]);
    configureSupabaseStub({
      session: { user: { id: 'u1' } },
      upsertError: { message: 'network unreachable' },
    });

    const result = await flushPending();

    expect(result.sent).toBe(0);
    expect(result.queued).toBe(2);
    // Nothing may be dropped on failure — the retry depends on it.
    expect((await readQueue()).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('queues without uploading when there is no session', async () => {
    await seedQueue([event('a')]);
    configureSupabaseStub({ session: null });

    const result = await flushPending();

    expect(result).toEqual({ sent: 0, queued: 1 });
    expect(supabaseStub.upserted).toEqual([]);
    expect((await readQueue()).map((e) => e.id)).toEqual(['a']);
  });

  it('stops draining after a bounded number of passes', async () => {
    await seedQueue([event('a')]);

    // A device appending faster than it can upload must not trap the flush in
    // an unbounded loop; leftovers wait for the next one.
    let counter = 0;
    configureSupabaseStub({
      session: { user: { id: 'u1' } },
      onUpsert: async () => {
        counter += 1;
        await seedQueue([...(await readQueue()), event(`gen${counter}`)]);
      },
    });

    const result = await flushPending();

    expect(supabaseStub.upserted.length).toBeLessThanOrEqual(5);
    expect(result.queued).toBeGreaterThan(0);
  });

  it('is a no-op on an empty queue', async () => {
    const result = await flushPending();
    expect(result).toEqual({ sent: 0, queued: 0 });
    expect(supabaseStub.upserted).toEqual([]);
  });
});
