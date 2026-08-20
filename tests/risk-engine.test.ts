import { describe, expect, it } from 'vitest';
import { assessRisk, bandFor, decisionFor, haversineKm } from '@/services/security/risk-engine';
import { categoryOf, type SecurityEvent, type SecurityEventType } from '@/types/security';

const USER = 'user-1';
const DAY = 24 * 60 * 60 * 1000;

/**
 * All times in these tests are relative to one fixed base rather than to
 * Date.now(). Two reasons: the odd-hour factor would otherwise fire or not
 * depending on when CI happens to run, and mixing "N ms before now" events with
 * an absolute `at` silently pushes events outside the detector's time windows.
 * Noon is chosen because it sits well outside the 01:00–05:00 odd-hour band.
 */
const BASE = new Date(new Date().setHours(12, 0, 0, 0));

/** Build a minimal event; hashes are irrelevant to scoring so they stay fixed. */
function event(
  type: SecurityEventType,
  msBefore: number,
  context: SecurityEvent['context'] = {},
): SecurityEvent {
  return {
    id: `e${msBefore}_${Math.random()}`,
    type,
    category: categoryOf(type),
    severity: 'info',
    timestamp: new Date(BASE.getTime() - msBefore).toISOString(),
    userId: USER,
    context,
    prevHash: '0x0',
    hash: '0x1',
  };
}

const TRUSTED = { deviceId: 'trusted', deviceName: 'Pixel 7' };
const ATTACKER = { deviceId: 'attacker', deviceName: 'Unknown Linux' };
const VELLORE = { city: 'Vellore', country: 'IN', lat: 12.9165, lon: 79.1325 };
const FRANKFURT = { city: 'Frankfurt', country: 'DE', lat: 50.1109, lon: 8.6821 };

/** Five days of ordinary use from one device — the comparison baseline. */
function baseline(): SecurityEvent[] {
  return [
    event('auth.login.success', 5 * DAY, { ...TRUSTED, ...VELLORE }),
    event('payment.completed', 5 * DAY, { ...TRUSTED, ...VELLORE, amountUsd: 45, counterparty: 'kousthub@globalpay' }),
    event('payment.completed', 3 * DAY, { ...TRUSTED, ...VELLORE, amountUsd: 32.5, counterparty: 'aditi@globalpay' }),
    event('payment.completed', 2 * DAY, { ...TRUSTED, ...VELLORE, amountUsd: 60, counterparty: 'kousthub@globalpay' }),
  ];
}

describe('haversineKm', () => {
  it('measures the Vellore–Frankfurt great-circle distance', () => {
    const km = haversineKm(VELLORE.lat, VELLORE.lon, FRANKFURT.lat, FRANKFURT.lon);
    // True great-circle distance is ~7,520 km between these city centroids.
    expect(km).toBeGreaterThan(6500);
    expect(km).toBeLessThan(7700);
  });

  it('returns zero for identical points', () => {
    expect(haversineKm(12.9, 79.1, 12.9, 79.1)).toBeCloseTo(0, 5);
  });
});

describe('bands and decisions', () => {
  it('maps scores to bands at the documented thresholds', () => {
    expect(bandFor(0)).toBe('low');
    expect(bandFor(24)).toBe('low');
    expect(bandFor(25)).toBe('medium');
    expect(bandFor(49)).toBe('medium');
    expect(bandFor(50)).toBe('high');
    expect(bandFor(74)).toBe('high');
    expect(bandFor(75)).toBe('critical');
    expect(bandFor(100)).toBe('critical');
  });

  it('escalates enforcement with the band', () => {
    expect(decisionFor('low')).toBe('allow');
    expect(decisionFor('medium')).toBe('monitor');
    expect(decisionFor('high')).toBe('challenge');
    expect(decisionFor('critical')).toBe('block');
  });
});

describe('assessRisk', () => {
  it('scores routine activity from an established device as low risk', () => {
    const risk = assessRisk(
      {
        action: 'payment',
        userId: USER,
        context: { ...TRUSTED, ...VELLORE, amountUsd: 50, counterparty: 'kousthub@globalpay' },
        // Midday, so the odd-hour factor cannot fire and make this flaky.
        at: BASE,
      },
      baseline(),
    );

    expect(risk.band).toBe('low');
    expect(risk.decision).toBe('allow');
    expect(risk.factors.filter((f) => f.triggered)).toHaveLength(0);
  });

  /**
   * Regression test for the bug where the event under assessment was included
   * in its own history: the attacker's device and payee looked "known", and a
   * textbook takeover scored 0/100.
   */
  it('ignores events at or after the moment being scored', () => {
    const now = BASE;
    const attackerContext = {
      ...ATTACKER,
      ...FRANKFURT,
      amountUsd: 4820,
      counterparty: '0x9f2Ac41B',
      ipReputationFlagged: true,
    };

    // The attacker's own activity is present in the log, including the very
    // event being scored. None of it may vouch for the action.
    const history = [
      ...baseline(),
      event('device.new', 6 * 60 * 1000, { ...ATTACKER, ...FRANKFURT }),
      { ...event('payment.initiated', 0, attackerContext), timestamp: now.toISOString() },
    ];

    const risk = assessRisk(
      { action: 'payment', userId: USER, context: attackerContext, at: now },
      history,
    );

    const triggered = risk.factors.filter((f) => f.triggered).map((f) => f.id);
    expect(triggered).toContain('new_device');
    expect(triggered).toContain('new_counterparty');
    expect(triggered).toContain('ip_reputation');
    expect(triggered).toContain('amount_anomaly');
    expect(risk.score).toBeGreaterThanOrEqual(50);
    expect(['challenge', 'block']).toContain(risk.decision);
  });

  it('does not trust a device merely because it was seen once', () => {
    const now = BASE;
    // The attacker registered their device 5 minutes ago — inside the trust window.
    const history = [...baseline(), event('device.new', 5 * 60 * 1000, { ...ATTACKER, ...FRANKFURT })];

    const risk = assessRisk(
      {
        action: 'login',
        userId: USER,
        context: { ...ATTACKER, ...FRANKFURT },
        at: now,
      },
      history,
    );

    expect(risk.factors.find((f) => f.id === 'new_device')?.triggered).toBe(true);
  });

  it('flags impossible travel between distant successive locations', () => {
    const now = BASE;
    const history = [
      event('auth.login.success', 8 * 60 * 1000, { ...TRUSTED, ...VELLORE }),
    ];

    const risk = assessRisk(
      { action: 'login', userId: USER, context: { ...ATTACKER, ...FRANKFURT }, at: now },
      history,
    );

    const travel = risk.factors.find((f) => f.id === 'impossible_travel');
    expect(travel?.triggered).toBe(true);
    expect(travel?.explanation).toMatch(/km\/h/);
  });

  it('does not flag travel that is physically achievable', () => {
    const now = BASE;
    // Same trip, but 24 hours of travel time — an ordinary flight.
    const history = [event('auth.login.success', DAY, { ...TRUSTED, ...VELLORE })];

    const risk = assessRisk(
      { action: 'login', userId: USER, context: { ...TRUSTED, ...FRANKFURT }, at: now },
      history,
    );

    expect(risk.factors.find((f) => f.id === 'impossible_travel')?.triggered).toBe(false);
  });

  it('scales the failed-authentication factor with attempt count', () => {
    const now = BASE;
    const few = Array.from({ length: 3 }, () => event('auth.login.failure', 60_000, TRUSTED));
    const many = Array.from({ length: 12 }, () => event('auth.login.failure', 60_000, TRUSTED));

    const low = assessRisk({ action: 'login', userId: USER, context: TRUSTED, at: now }, few);
    const high = assessRisk({ action: 'login', userId: USER, context: TRUSTED, at: now }, many);

    const contribution = (r: typeof low) =>
      r.factors.find((f) => f.id === 'failed_auth_burst')!.contribution;

    expect(contribution(high)).toBeGreaterThan(contribution(low));
  });

  it('never exceeds 100 even when every factor fires', () => {
    // 03:00 so the odd-hour factor participates. History is shifted to sit
    // before this moment, since events at or after it are excluded by design.
    const now = new Date(BASE.getTime() - 9 * 60 * 60 * 1000);
    const shift = (e: SecurityEvent): SecurityEvent => ({
      ...e,
      timestamp: new Date(new Date(e.timestamp).getTime() - 9 * 60 * 60 * 1000).toISOString(),
    });
    const history = [
      ...baseline(),
      ...Array.from({ length: 20 }, () => event('auth.login.failure', 60_000, ATTACKER)),
      ...Array.from({ length: 8 }, () => event('payment.initiated', 60_000, ATTACKER)),
      event('auth.login.success', 5 * 60 * 1000, { ...TRUSTED, ...VELLORE }),
    ].map(shift);

    const risk = assessRisk(
      {
        action: 'payment',
        userId: USER,
        context: {
          ...ATTACKER,
          ...FRANKFURT,
          amountUsd: 999_999,
          counterparty: 'attacker-wallet',
          ipReputationFlagged: true,
        },
        at: now,
      },
      history,
    );

    expect(risk.score).toBeLessThanOrEqual(100);
    expect(risk.score).toBeGreaterThanOrEqual(75);
    expect(risk.decision).toBe('block');
  });

  it('keeps one user’s history out of another user’s score', () => {
    const now = BASE;
    const otherUsersEvents = baseline().map((e) => ({ ...e, userId: 'someone-else' }));

    const risk = assessRisk(
      { action: 'login', userId: USER, context: { ...ATTACKER, ...FRANKFURT }, at: now },
      otherUsersEvents,
    );

    // With no history of its own, the account has no baseline to deviate from,
    // so comparative factors must stay silent rather than firing spuriously.
    expect(risk.factors.find((f) => f.id === 'new_device')?.triggered).toBe(false);
    expect(risk.factors.find((f) => f.id === 'impossible_travel')?.triggered).toBe(false);
  });

  it('always returns every factor so the UI can show what did not fire', () => {
    const risk = assessRisk(
      { action: 'login', userId: USER, context: TRUSTED, at: new Date() },
      [],
    );
    expect(risk.factors).toHaveLength(8);
    expect(risk.factors.every((f) => f.explanation.length > 0)).toBe(true);
  });
});
