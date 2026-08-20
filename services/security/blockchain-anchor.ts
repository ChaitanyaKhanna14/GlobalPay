/**
 * Blockchain audit anchoring.
 *
 * ── What this does, and what it deliberately does not ──
 * Blockchain here is an *integrity* control, not a confidentiality one. It does
 * not encrypt anything and it does not protect data in transit — TLS does that,
 * and encrypted storage protects data at rest. What a public chain uniquely
 * provides is an append-only record nobody, including us, can retroactively
 * rewrite.
 *
 * So we anchor **hashes only**. A Merkle root over a batch of security-event
 * digests goes on-chain; the events themselves never leave our own storage. No
 * PII, no balances, no addresses, no keys are published. Later, anyone can
 * recompute the root from the retained events and compare it against the
 * immutable on-chain value:
 *
 *   roots match     → the log is byte-identical to what was committed
 *   roots differ    → the log has been altered since anchoring
 *
 * That is the property an auditor actually needs, and the one a database alone
 * cannot give you: a malicious administrator with full write access to our
 * database still cannot forge a matching root on Polygon.
 *
 * ── Merkle tree over a plain hash ──
 * A single hash of the whole batch would also detect tampering, but a Merkle
 * root additionally supports *inclusion proofs*: proving one specific event was
 * in the anchored batch requires only log₂(n) sibling hashes, not the entire
 * log. That matters when proving a single disputed transaction to a regulator
 * without disclosing every other customer's events.
 */
import { keccak256, toUtf8Bytes, concat, getBytes } from 'ethers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { POLYGON_CHAIN_ID, POLYGONSCAN_URL, NETWORK_NAME } from '@/constants/tokens';
import type { AuditAnchor, SecurityEvent } from '@/types/security';

const ANCHOR_STORAGE_KEY = 'globalpay_audit_anchors';

// ─── Merkle tree ────────────────────────────────

/** Hash a pair of nodes. Both are already 32-byte hex digests. */
function hashPair(a: string, b: string): string {
  return keccak256(concat([getBytes(a), getBytes(b)]));
}

/**
 * Compute the Merkle root of a list of leaf hashes.
 *
 * Odd nodes at a level are promoted unchanged rather than duplicated. Duplicating
 * the last node (the Bitcoin approach) admits a known malleability quirk where
 * two different leaf sets can yield the same root; promotion avoids it.
 */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return keccak256(toUtf8Bytes('globalpay:empty'));
  if (leaves.length === 1) return leaves[0];

  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

/** A sibling hash plus which side it sits on, for verifying an inclusion proof. */
export interface MerkleProofStep {
  hash: string;
  position: 'left' | 'right';
}

/** Build the inclusion proof for the leaf at `index`. */
export function merkleProof(leaves: string[], index: number): MerkleProofStep[] {
  const proof: MerkleProofStep[] = [];
  let level = [...leaves];
  let idx = index;

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : null;

      if (right === null) {
        // Promoted node — no sibling, so nothing is added to the proof.
        next.push(left);
      } else {
        if (i === idx) proof.push({ hash: right, position: 'right' });
        else if (i + 1 === idx) proof.push({ hash: left, position: 'left' });
        next.push(hashPair(left, right));
      }
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

/** Recompute a root from a leaf and its proof. */
export function verifyMerkleProof(
  leaf: string,
  proof: MerkleProofStep[],
  root: string,
): boolean {
  let computed = leaf;
  for (const step of proof) {
    computed =
      step.position === 'right' ? hashPair(computed, step.hash) : hashPair(step.hash, computed);
  }
  return computed.toLowerCase() === root.toLowerCase();
}

/** The Merkle root covering a batch of security events. */
export function rootForEvents(events: SecurityEvent[]): string {
  return merkleRoot(events.map((e) => e.hash));
}

// ─── Anchor persistence ─────────────────────────

export async function loadAnchors(): Promise<AuditAnchor[]> {
  try {
    const raw = await AsyncStorage.getItem(ANCHOR_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuditAnchor[]) : [];
  } catch {
    return [];
  }
}

async function saveAnchors(anchors: AuditAnchor[]): Promise<void> {
  await AsyncStorage.setItem(ANCHOR_STORAGE_KEY, JSON.stringify(anchors));
}

export async function latestAnchor(): Promise<AuditAnchor | null> {
  const anchors = await loadAnchors();
  return anchors.length ? anchors[anchors.length - 1] : null;
}

// ─── Anchoring ──────────────────────────────────

/**
 * How the root reaches the chain.
 *
 * `local`  — compute and store the root without broadcasting. Costs nothing and
 *            still proves the log has not been edited *since* the anchor was
 *            taken. This is the default so the SOC works with no funded wallet.
 * `onchain`— submit the root as the calldata of a 0-value self-transaction on
 *            Polygon Amoy. Requires a funded testnet wallet. A dedicated
 *            registry contract would be the production choice; a self-send is
 *            the minimum viable way to get 32 bytes immutably timestamped.
 */
export type AnchorMode = 'local' | 'onchain';

export interface AnchorResult {
  anchor: AuditAnchor;
  /** Present when the anchor was only computed locally. */
  note?: string;
}

let anchorCounter = 0;

export async function anchorEvents(
  events: SecurityEvent[],
  mode: AnchorMode = 'local',
  /** Injected so this module never imports the wallet service directly. */
  submitOnChain?: (root: string) => Promise<string>,
): Promise<AnchorResult> {
  const root = rootForEvents(events);
  const now = new Date().toISOString();

  const anchor: AuditAnchor = {
    id: `anc_${Date.now().toString(36)}_${(anchorCounter++).toString(36)}`,
    merkleRoot: root,
    eventCount: events.length,
    fromTimestamp: events.length ? events[0].timestamp : now,
    toTimestamp: events.length ? events[events.length - 1].timestamp : now,
    createdAt: now,
    status: 'pending',
    chainId: POLYGON_CHAIN_ID,
  };

  let note: string | undefined;

  if (mode === 'onchain' && submitOnChain) {
    try {
      const txHash = await submitOnChain(root);
      anchor.status = 'anchored';
      anchor.txHash = txHash;
      anchor.explorerUrl = `${POLYGONSCAN_URL}/tx/${txHash}`;
    } catch (e) {
      anchor.status = 'failed';
      anchor.error = e instanceof Error ? e.message : String(e);
      note = `On-chain submission to ${NETWORK_NAME} failed — the root was still recorded locally.`;
    }
  } else {
    anchor.status = 'anchored';
    note =
      `Root computed and sealed locally. Publishing it to ${NETWORK_NAME} additionally proves ` +
      `the root itself was not rewritten, and requires a funded testnet wallet.`;
  }

  const anchors = await loadAnchors();
  anchors.push(anchor);
  await saveAnchors(anchors);

  return { anchor, note };
}

/**
 * Re-derive the root from the retained events and compare it with what was
 * anchored. This is the check an auditor runs.
 */
export function compareRoots(
  events: SecurityEvent[],
  anchor: AuditAnchor,
): { matches: boolean; computedRoot: string; anchoredRoot: string } {
  // Only the events the anchor actually covered participate in the comparison.
  const covered = events.filter(
    (e) => e.timestamp >= anchor.fromTimestamp && e.timestamp <= anchor.toTimestamp,
  );
  const computedRoot = rootForEvents(covered);
  return {
    matches: computedRoot.toLowerCase() === anchor.merkleRoot.toLowerCase(),
    computedRoot,
    anchoredRoot: anchor.merkleRoot,
  };
}

/** Wipe anchors. Development and demo-reset only. */
export async function clearAnchors(): Promise<void> {
  await AsyncStorage.removeItem(ANCHOR_STORAGE_KEY);
}
