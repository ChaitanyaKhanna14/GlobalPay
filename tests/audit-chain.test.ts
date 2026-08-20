import { beforeEach, describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  chainHead,
  clearEvents,
  hashEvent,
  loadEvents,
  recordEvent,
  recordEvents,
  verifyChain,
} from '@/services/security/event-log';
import {
  compareRoots,
  merkleProof,
  merkleRoot,
  rootForEvents,
  verifyMerkleProof,
} from '@/services/security/blockchain-anchor';
import type { AuditAnchor, SecurityEvent } from '@/types/security';

const USER = 'user-1';

beforeEach(async () => {
  await clearEvents();
});

describe('hash chain', () => {
  it('links the first event to genesis', async () => {
    const e = await recordEvent({ type: 'auth.login.success', userId: USER });
    expect(e.prevHash).toBe(GENESIS_HASH);
    expect(e.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('links each event to its predecessor', async () => {
    const a = await recordEvent({ type: 'auth.login.success', userId: USER });
    const b = await recordEvent({ type: 'payment.initiated', userId: USER });
    const c = await recordEvent({ type: 'payment.completed', userId: USER });

    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(chainHead(await loadEvents())).toBe(c.hash);
  });

  it('verifies an untampered chain', async () => {
    await recordEvents([
      { type: 'auth.login.success', userId: USER },
      { type: 'payment.initiated', userId: USER, context: { amountUsd: 10 } },
      { type: 'payment.completed', userId: USER, context: { amountUsd: 10 } },
    ]);

    const result = verifyChain(await loadEvents());
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(3);
  });

  it('produces different digests for different content', async () => {
    const a = await recordEvent({
      type: 'payment.completed',
      userId: USER,
      context: { amountUsd: 500 },
    });
    await clearEvents();
    const b = await recordEvent({
      type: 'payment.completed',
      userId: USER,
      context: { amountUsd: 50_000 },
    });
    expect(a.hash).not.toBe(b.hash);
  });

  /**
   * The central claim of the audit layer: silently editing a stored event must
   * be detectable. Here an attacker rewrites a $10 transfer into a $50,000 one.
   */
  it('detects an edited event', async () => {
    await recordEvents([
      { type: 'auth.login.success', userId: USER },
      { type: 'payment.completed', userId: USER, context: { amountUsd: 10 } },
      { type: 'auth.logout', userId: USER },
    ]);

    const events = await loadEvents();
    events[1].context.amountUsd = 50_000;

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAtIndex).toBe(1);
    expect(result.brokenEventId).toBe(events[1].id);
  });

  it('detects a deleted event', async () => {
    await recordEvents([
      { type: 'auth.login.success', userId: USER },
      { type: 'payment.completed', userId: USER, context: { amountUsd: 10 } },
      { type: 'auth.logout', userId: USER },
    ]);

    const events = await loadEvents();
    events.splice(1, 1); // remove the middle event

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
  });

  /**
   * An attacker who understands the scheme will edit an event *and* recompute
   * every hash after it, producing an internally consistent chain. The local
   * check cannot catch this — which is exactly why the root is anchored.
   */
  it('cannot catch a fully recomputed chain on its own', async () => {
    await recordEvents([
      { type: 'auth.login.success', userId: USER },
      { type: 'payment.completed', userId: USER, context: { amountUsd: 10 } },
      { type: 'auth.logout', userId: USER },
    ]);

    const events = await loadEvents();
    events[1].context.amountUsd = 50_000;

    // Re-derive every hash from the tampered event forward.
    for (let i = 1; i < events.length; i++) {
      const { hash, prevHash, ...base } = events[i];
      const newPrev = i === 0 ? GENESIS_HASH : events[i - 1].hash;
      events[i].prevHash = newPrev;
      events[i].hash = hashEvent(base, newPrev);
    }

    expect(verifyChain(events).valid).toBe(true); // locally consistent…
  });
});

describe('merkle root', () => {
  const leaf = (n: number) => hashEvent(
    {
      id: `e${n}`,
      type: 'auth.login.success',
      category: 'authentication',
      severity: 'info',
      timestamp: new Date(1_700_000_000_000 + n).toISOString(),
      userId: USER,
      context: {},
    },
    GENESIS_HASH,
  );

  it('returns a stable root for the same leaves', () => {
    const leaves = [leaf(1), leaf(2), leaf(3), leaf(4)];
    expect(merkleRoot(leaves)).toBe(merkleRoot([...leaves]));
  });

  it('changes when any leaf changes', () => {
    const before = merkleRoot([leaf(1), leaf(2), leaf(3), leaf(4)]);
    const after = merkleRoot([leaf(1), leaf(99), leaf(3), leaf(4)]);
    expect(before).not.toBe(after);
  });

  it('handles a single leaf and an empty set', () => {
    expect(merkleRoot([leaf(1)])).toBe(leaf(1));
    expect(merkleRoot([])).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('handles odd leaf counts by promotion', () => {
    expect(merkleRoot([leaf(1), leaf(2), leaf(3)])).toMatch(/^0x[0-9a-f]{64}$/);
    expect(merkleRoot([leaf(1), leaf(2), leaf(3), leaf(4), leaf(5)])).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('proves inclusion of every leaf', () => {
    for (const count of [2, 3, 4, 5, 8]) {
      const leaves = Array.from({ length: count }, (_, i) => leaf(i));
      const root = merkleRoot(leaves);
      leaves.forEach((l, i) => {
        expect(
          verifyMerkleProof(l, merkleProof(leaves, i), root),
          `leaf ${i} of ${count} should verify`,
        ).toBe(true);
      });
    }
  });

  it('rejects a proof for a leaf that is not in the tree', () => {
    const leaves = [leaf(1), leaf(2), leaf(3), leaf(4)];
    const root = merkleRoot(leaves);
    expect(verifyMerkleProof(leaf(99), merkleProof(leaves, 0), root)).toBe(false);
  });
});

describe('anchored root comparison', () => {
  async function anchoredFixture(): Promise<{ events: SecurityEvent[]; anchor: AuditAnchor }> {
    await recordEvents([
      { type: 'auth.login.success', userId: USER },
      { type: 'payment.completed', userId: USER, context: { amountUsd: 10 } },
      { type: 'auth.logout', userId: USER },
    ]);
    const events = await loadEvents();
    const anchor: AuditAnchor = {
      id: 'anc_test',
      merkleRoot: rootForEvents(events),
      eventCount: events.length,
      fromTimestamp: events[0].timestamp,
      toTimestamp: events[events.length - 1].timestamp,
      createdAt: new Date().toISOString(),
      status: 'anchored',
    };
    return { events, anchor };
  }

  it('matches when nothing has changed', async () => {
    const { events, anchor } = await anchoredFixture();
    expect(compareRoots(events, anchor).matches).toBe(true);
  });

  /**
   * The payoff: the recomputed-chain attack that defeated the local check is
   * caught here, because the attacker cannot rewrite the anchored root.
   */
  it('catches a tampered log even after every hash is recomputed', async () => {
    const { events, anchor } = await anchoredFixture();

    events[1].context.amountUsd = 50_000;
    for (let i = 1; i < events.length; i++) {
      const { hash, prevHash, ...base } = events[i];
      const newPrev = events[i - 1].hash;
      events[i].prevHash = newPrev;
      events[i].hash = hashEvent(base, newPrev);
    }

    expect(verifyChain(events).valid).toBe(true); // internally consistent
    const comparison = compareRoots(events, anchor);
    expect(comparison.matches).toBe(false); // …but provably not the anchored log
    expect(comparison.computedRoot).not.toBe(comparison.anchoredRoot);
  });
});
