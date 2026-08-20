/**
 * Publishes a Merkle root to Polygon.
 *
 * `blockchain-anchor.ts` deliberately takes this as an injected callback rather
 * than importing the wallet itself: the Merkle and verification logic must stay
 * free of signing concerns so it can be unit-tested in plain Node, and so the
 * audit layer never holds a reference to a key.
 *
 * ── Why a self-transaction ──
 * The root is written as the calldata of a zero-value transaction from the
 * user's wallet to itself. Nothing is transferred; the transaction exists only
 * so that 32 bytes acquire an immutable, timestamped position in a public
 * ledger. A dedicated registry contract with an `anchor(bytes32)` function
 * emitting an event would be the production choice — cheaper to index and
 * queryable by anyone — but a self-send needs no deployment and gives the same
 * immutability guarantee, which is the property being demonstrated.
 *
 * ── Cost ──
 * Calldata is billed per byte, so a 32-byte root is among the cheapest possible
 * transactions. On Amoy testnet it costs nothing real. Anchoring is also
 * batched by design: one root covers an arbitrary number of events, so the
 * per-event cost trends to zero.
 */
import { formatEther } from 'ethers';
import { walletService } from '@/services/wallet';
import { NETWORK_NAME } from '@/constants/tokens';

/**
 * Submit a Merkle root and return the transaction hash.
 *
 * Throws with an actionable message rather than a raw RPC error — "insufficient
 * funds" from ethers tells a user nothing about how to fix it.
 */
export async function submitRootOnChain(root: string): Promise<string> {
  const signer = await walletService.getSigner();
  if (!signer) {
    throw new Error(
      'No wallet is available on this device to sign the anchor transaction. Sign in first.',
    );
  }

  const address = await signer.getAddress();

  // Check for gas up front so the failure is comprehensible.
  const balance = await walletService.getProvider().getBalance(address);
  if (balance === 0n) {
    throw new Error(
      `Wallet ${address.slice(0, 10)}… holds no POL on ${NETWORK_NAME}, so it cannot pay gas. ` +
        `Fund it from a faucet, or keep using local anchoring.`,
    );
  }

  const tx = await signer.sendTransaction({
    to: address, // self-send: nothing moves, only the calldata matters
    value: 0n,
    data: root, // the 32-byte Merkle root
  });

  await tx.wait();
  return tx.hash;
}

/** Current gas balance, for showing whether on-chain anchoring is possible. */
export async function anchoringBalance(): Promise<{ address: string; pol: string } | null> {
  const address = await walletService.getWalletAddress();
  if (!address) return null;
  const balance = await walletService.getProvider().getBalance(address);
  return { address, pol: formatEther(balance) };
}
