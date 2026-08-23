/**
 * A payment resolves its destination from users.wallet_address, and that column
 * can legitimately hold a pre-enrolment placeholder — the wallet is
 * non-custodial, so the keypair only exists once its owner signs in on their own
 * device. The failure this guards against is silent and unrecoverable: an
 * address-shaped placeholder is a perfectly valid burn address, so the transfer
 * would succeed, the receipt would look normal, and the tokens would be gone.
 */
import { describe, it, expect } from 'vitest';
import { isEnrolledWallet } from '@/services/security/recipient-guard';

describe('isEnrolledWallet', () => {
  it('accepts a checksummed address', () => {
    expect(isEnrolledWallet('0x438fA986d456F5739Ea7f682781c853593ebc7AF')).toBe(true);
  });

  it('accepts an all-lowercase address', () => {
    expect(isEnrolledWallet('0x438fa986d456f5739ea7f682781c853593ebc7af')).toBe(true);
  });

  it('rejects the pre-enrolment placeholder', () => {
    expect(isEnrolledWallet('pending-device-enrolment:kousthub')).toBe(false);
  });

  it('cannot distinguish the zero address from a real one', () => {
    // Syntactically valid, unspendable in practice — this guard has no way to
    // tell. That limitation is precisely why the pre-enrolment placeholder is
    // deliberately not address-shaped: prevention at the source, not detection
    // at the boundary.
    expect(isEnrolledWallet('0x' + '0'.repeat(40))).toBe(true);
  });

  it('rejects empty, null and undefined', () => {
    expect(isEnrolledWallet('')).toBe(false);
    expect(isEnrolledWallet(null)).toBe(false);
    expect(isEnrolledWallet(undefined)).toBe(false);
  });

  it('rejects a truncated or overlong address', () => {
    expect(isEnrolledWallet('0x438fA986')).toBe(false);
    expect(isEnrolledWallet('0x438fA986d456F5739Ea7f682781c853593ebc7AF00')).toBe(false);
  });

  it('rejects a bad checksum, which is usually a typo', () => {
    // Mixed case with the wrong casing pattern fails EIP-55 verification.
    expect(isEnrolledWallet('0x438FA986d456F5739Ea7f682781c853593ebc7AF')).toBe(false);
  });
});
