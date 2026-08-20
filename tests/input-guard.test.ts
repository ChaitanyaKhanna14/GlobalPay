import { describe, expect, it, vi } from 'vitest';

// The guard records to the SOC as a side effect; stub it so these tests stay
// focused on detection accuracy rather than on the event pipeline.
vi.mock('@/services/security/instrument', () => ({
  recordInjectionAttempt: vi.fn(),
}));

import { guardInput, isValidRecipient } from '@/services/security/input-guard';

describe('guardInput', () => {
  it('flags classic SQL injection probes', () => {
    const payloads = [
      "' OR '1'='1",
      "admin'--",
      "'; DROP TABLE users;--",
      "' UNION SELECT wallet_address FROM users--",
      "1' AND '1'='1",
      "x' OR 1=1--",
    ];
    for (const payload of payloads) {
      expect(guardInput('recipient', payload).safe, `should flag: ${payload}`).toBe(false);
    }
  });

  it('flags metadata probing', () => {
    expect(guardInput('recipient', 'SELECT * FROM information_schema.tables').safe).toBe(false);
  });

  it('flags script and template injection', () => {
    expect(guardInput('note', '<script>alert(1)</script>').safe).toBe(false);
    expect(guardInput('note', 'javascript:alert(1)').safe).toBe(false);
    expect(guardInput('note', '${process.env.SECRET}').safe).toBe(false);
    expect(guardInput('note', '{{constructor.constructor("x")()}}').safe).toBe(false);
  });

  it('flags NoSQL operator injection', () => {
    expect(guardInput('recipient', '{"$ne": null}').safe).toBe(false);
  });

  it('names which pattern matched, so the SOC entry is actionable', () => {
    const result = guardInput('recipient', "' UNION SELECT password FROM users");
    expect(result.safe).toBe(false);
    expect(result.matched).toBe('UNION SELECT');
  });

  /**
   * False positives matter more than they look: a detector that fires on
   * ordinary input gets muted by the people it is meant to help.
   */
  it('does not flag legitimate input', () => {
    const benign = [
      'nehan@globalpay',
      'kousthub_reddy@globalpay',
      '0x9f2A1b3C4d5E6f7890AbCdEf1234567890AbCdEf',
      'aditi.tantiya@globalpay',
      "Dinner — Nehan's share",
      'Rent for March (1/2)',
      'Payment #42',
      '',
    ];
    for (const value of benign) {
      expect(guardInput('recipient', value).safe, `should allow: ${value}`).toBe(true);
    }
  });
});

describe('isValidRecipient', () => {
  it('accepts the two identifier shapes the app supports', () => {
    expect(isValidRecipient('nehan@globalpay')).toBe(true);
    expect(isValidRecipient('a_b.c-d@globalpay')).toBe(true);
    expect(isValidRecipient('0x9f2A1b3C4d5E6f7890AbCdEf1234567890AbCdEf')).toBe(true);
    expect(isValidRecipient('  nehan@globalpay  ')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isValidRecipient('nehan')).toBe(false);              // missing domain
    expect(isValidRecipient('nehan@gmail.com')).toBe(false);    // wrong domain
    expect(isValidRecipient('0x123')).toBe(false);              // truncated address
    expect(isValidRecipient("' OR '1'='1")).toBe(false);
    expect(isValidRecipient('ab@globalpay')).toBe(false);       // below min length
  });
});
