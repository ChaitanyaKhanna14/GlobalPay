/**
 * Recipient wallet validation.
 *
 * `users.wallet_address` is NOT NULL, but a row can legitimately exist before
 * its owner has enrolled a device: the wallet is non-custodial, so the keypair
 * is generated on the phone at first sign-in and nowhere else. Until then the
 * column holds a placeholder.
 *
 * A payment resolves its destination through that column, so an unvalidated
 * placeholder is a fund-loss bug: an address-shaped placeholder would be a
 * perfectly transferable burn address, and the tokens would be gone with a
 * successful-looking receipt. Placeholders are therefore deliberately NOT
 * address-shaped, and this guard rejects anything that is not a real address
 * before it can reach a transfer.
 */
import { isAddress } from 'ethers';

/** True only for a syntactically valid EVM address. */
export function isEnrolledWallet(address: string | null | undefined): boolean {
  return typeof address === 'string' && isAddress(address);
}

export const UNENROLLED_RECIPIENT_TITLE = 'Recipient not ready';
export const UNENROLLED_RECIPIENT_MESSAGE =
  'That account exists but has not finished setting up its wallet yet. ' +
  'Ask them to sign in on their device once, then try again.';
