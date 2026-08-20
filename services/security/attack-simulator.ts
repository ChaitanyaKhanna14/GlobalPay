/**
 * Attack simulator.
 *
 * Generates realistic security-event sequences so the detection rules, risk
 * engine, and SOC dashboard can be exercised on demand — during a review, in a
 * demo, or in tests — without anyone needing to mount a real attack.
 *
 * ── Scope, deliberately ──
 * This module writes *synthetic log entries into our own event store*. It sends
 * no network traffic, touches no third party, and cannot be pointed at another
 * system. It is a fixture generator, not an attack tool: the offensive side of
 * each scenario exists here only as a description of what the resulting logs
 * would look like.
 *
 * Every simulated event carries `simulated: true` in its context so the SOC can
 * label it and no one mistakes a drill for a real incident.
 */
import type { RecordEventInput } from './event-log';
import { recordEvents } from './event-log';
import type { EventContext, SecurityEventType } from '@/types/security';

export type ScenarioId =
  | 'credential_stuffing'
  | 'impossible_travel'
  | 'account_takeover'
  | 'wallet_draining'
  | 'pin_brute_force'
  | 'injection_probe'
  | 'normal_activity';

export interface Scenario {
  id: ScenarioId;
  name: string;
  description: string;
  /** What an analyst should expect to see fire. */
  expectedDetections: string[];
  icon: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'credential_stuffing',
    name: 'Credential Stuffing',
    description:
      'An attacker replays 40 breached username/password pairs against the login endpoint from a VPN exit node, then succeeds on one.',
    expectedDetections: ['Credential Stuffing (T1110.004)'],
    icon: 'key',
  },
  {
    id: 'impossible_travel',
    name: 'Impossible Travel',
    description:
      'A session opens in Mumbai, then eight minutes later another session for the same account opens in Frankfurt — 6,000 km away.',
    expectedDetections: ['Impossible Travel (T1078)'],
    icon: 'airplane',
  },
  {
    id: 'account_takeover',
    name: 'Account Takeover Chain',
    description:
      'Sign-in from an unknown device, immediately followed by a password change, a recovery-email change, and a large outbound transfer.',
    expectedDetections: [
      'Account Takeover Sequence (T1098)',
      'High-Value Transfer from New Device',
    ],
    icon: 'person-remove',
  },
  {
    id: 'wallet_draining',
    name: 'Wallet Draining',
    description:
      'Seven rapid outbound transfers to a single beneficiary, followed by an export of the wallet private key.',
    expectedDetections: ['Payment Velocity Anomaly', 'Private Key Export (T1555)'],
    icon: 'water',
  },
  {
    id: 'pin_brute_force',
    name: 'PIN Brute Force',
    description:
      'Six consecutive incorrect app-lock PIN entries on a stolen device, triggering the progressive lockout.',
    expectedDetections: ['PIN Brute Force (T1110)'],
    icon: 'lock-closed',
  },
  {
    id: 'injection_probe',
    name: 'SQL Injection Probe',
    description:
      'Injection payloads submitted to the GlobalPay ID lookup parameter, rejected by input validation.',
    expectedDetections: ['Injection Attempt (T1190)'],
    icon: 'code-slash',
  },
  {
    id: 'normal_activity',
    name: 'Normal Activity (Baseline)',
    description:
      'A day of ordinary, legitimate use — logins from a known device and modest payments. Establishes the baseline the anomaly detectors score against, and should fire nothing.',
    expectedDetections: ['None — this is the control case'],
    icon: 'checkmark-circle',
  },
];

// ─── Fixture data ───────────────────────────────
const CITIES = {
  mumbai: { city: 'Mumbai', country: 'IN', lat: 19.076, lon: 72.8777 },
  frankfurt: { city: 'Frankfurt', country: 'DE', lat: 50.1109, lon: 8.6821 },
  vellore: { city: 'Vellore', country: 'IN', lat: 12.9165, lon: 79.1325 },
  lagos: { city: 'Lagos', country: 'NG', lat: 6.5244, lon: 3.3792 },
};

const TRUSTED_DEVICE = { deviceId: 'dev_trusted_pixel7', deviceName: 'Pixel 7 (trusted)' };
const ATTACKER_DEVICE = { deviceId: 'dev_unknown_linux', deviceName: 'Unknown Linux client' };

const INJECTION_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE users;--",
  "admin'--",
  "' UNION SELECT wallet_address FROM users--",
];

/** Timestamp helper — `minutesAgo` before the anchor time. */
function at(base: number, minutesAgo: number, secondsOffset = 0): string {
  return new Date(base - minutesAgo * 60_000 + secondsOffset * 1000).toISOString();
}

export interface SimulationTarget {
  userId: string;
  actor: string;
}

/**
 * Build the event sequence for a scenario. Pure — returns inputs without
 * writing them, so scenarios can be inspected or unit-tested.
 */
export function buildScenario(
  scenario: ScenarioId,
  target: SimulationTarget,
): RecordEventInput[] {
  const now = Date.now();
  const { userId, actor } = target;

  const evt = (
    type: SecurityEventType,
    minutesAgo: number,
    context: EventContext,
    secondsOffset = 0,
  ): RecordEventInput => ({
    type,
    userId,
    actor,
    timestamp: at(now, minutesAgo, secondsOffset),
    context: { ...context, simulated: true },
  });

  /**
   * A short history of legitimate use from the trusted device, days old.
   *
   * Attack scenarios prepend this because the anomaly detectors are all
   * comparative: "unrecognised device", "amount anomaly" and "first-time
   * recipient" have no meaning without a baseline to deviate from. Without it
   * the attacker's own activity would be the entire history and would score as
   * perfectly normal. The events are deliberately days old so the trusted
   * device clears the 24-hour trust-establishment window.
   */
  const baseline = (): RecordEventInput[] => [
    evt('auth.login.success', 5 * 1440, { ...TRUSTED_DEVICE, ...CITIES.vellore, ipAddress: '49.36.12.8' }),
    evt('payment.completed', 5 * 1440 - 30, {
      ...TRUSTED_DEVICE,
      ...CITIES.vellore,
      amountUsd: 45.0,
      token: 'USDC',
      counterparty: 'kousthub@globalpay',
    }),
    evt('auth.login.success', 3 * 1440, { ...TRUSTED_DEVICE, ...CITIES.vellore, ipAddress: '49.36.12.8' }),
    evt('payment.completed', 3 * 1440 - 20, {
      ...TRUSTED_DEVICE,
      ...CITIES.vellore,
      amountUsd: 32.5,
      token: 'USDC',
      counterparty: 'aditi@globalpay',
    }),
    evt('payment.completed', 2 * 1440, {
      ...TRUSTED_DEVICE,
      ...CITIES.vellore,
      amountUsd: 60.0,
      token: 'USDC',
      counterparty: 'kousthub@globalpay',
    }),
  ];

  switch (scenario) {
    case 'credential_stuffing': {
      const events: RecordEventInput[] = [];
      // 40 attempts across ~3 minutes from a flagged IP.
      for (let i = 0; i < 40; i++) {
        events.push(
          evt('auth.login.failure', 12, {
            ...ATTACKER_DEVICE,
            ...CITIES.lagos,
            ipAddress: '185.220.101.47',
            ipReputationFlagged: true,
            detail: `Attempt ${i + 1}/40 — credential pair from breach corpus`,
          }, i * 4.5),
        );
      }
      // The one that lands.
      events.push(
        evt('auth.login.success', 8, {
          ...ATTACKER_DEVICE,
          ...CITIES.lagos,
          ipAddress: '185.220.101.47',
          ipReputationFlagged: true,
          detail: 'Valid credential pair accepted after 40 failures',
        }),
      );
      return events;
    }

    case 'impossible_travel':
      return [
        evt('auth.login.success', 20, {
          ...TRUSTED_DEVICE,
          ...CITIES.mumbai,
          ipAddress: '49.36.12.8',
          detail: 'Routine sign-in from trusted device',
        }),
        evt('auth.login.success', 12, {
          ...ATTACKER_DEVICE,
          ...CITIES.frankfurt,
          ipAddress: '89.246.11.203',
          ipReputationFlagged: true,
          detail: 'Second concurrent session, 6,000 km from the first',
        }),
      ];

    case 'account_takeover': {
      const attacker = {
        ...ATTACKER_DEVICE,
        ...CITIES.frankfurt,
        ipAddress: '89.246.11.203',
        ipReputationFlagged: true,
      };
      return [
        ...baseline(),
        evt('device.new', 25, {
          ...attacker,
          detail: 'First sighting of this device on the account',
        }),
        evt('auth.login.success', 24, attacker),
        evt('auth.password.change', 22, {
          ...attacker,
          detail: 'Password rotated from the new device',
        }),
        evt('account.email_change', 21, {
          ...attacker,
          detail: 'Recovery email repointed — locks the owner out of self-service reset',
        }),
        evt('payment.initiated', 19, {
          ...attacker,
          amountUsd: 4820,
          token: 'USDC',
          counterparty: '0x9f2A…c41B',
          detail: 'Large transfer to a never-before-seen address',
        }),
      ];
    }

    case 'wallet_draining': {
      const attacker = {
        ...ATTACKER_DEVICE,
        ...CITIES.frankfurt,
        ipAddress: '89.246.11.203',
        ipReputationFlagged: true,
      };
      const events: RecordEventInput[] = [...baseline()];
      for (let i = 0; i < 7; i++) {
        events.push(
          evt('payment.initiated', 15 - i, {
            ...attacker,
            amountUsd: 900 + i * 60,
            token: 'USDC',
            counterparty: '0x9f2A…c41B',
            detail: `Drain transfer ${i + 1}/7 to a single beneficiary`,
          }),
        );
      }
      events.push(
        evt('wallet.key_exported', 7, {
          ...attacker,
          detail: 'Private key exported — non-custodial funds are unrecoverable after this',
        }),
      );
      return events;
    }

    case 'pin_brute_force': {
      const events: RecordEventInput[] = [];
      for (let i = 0; i < 6; i++) {
        events.push(
          evt('pin.failure', 10, {
            ...ATTACKER_DEVICE,
            ...CITIES.vellore,
            detail: `Incorrect PIN attempt ${i + 1}/6`,
          }, i * 20),
        );
      }
      events.push(
        evt('pin.lockout', 8, {
          ...ATTACKER_DEVICE,
          ...CITIES.vellore,
          detail: 'Progressive lockout engaged for 30 minutes',
        }),
      );
      return events;
    }

    case 'injection_probe':
      return INJECTION_PAYLOADS.map((payload, i) =>
        evt('appsec.injection_attempt', 6, {
          ...ATTACKER_DEVICE,
          ...CITIES.lagos,
          ipAddress: '185.220.101.47',
          ipReputationFlagged: true,
          detail: `Payload rejected by input validation: ${payload}`,
        }, i * 12),
      );

    case 'normal_activity':
      return [
        evt('auth.login.success', 240, { ...TRUSTED_DEVICE, ...CITIES.vellore, ipAddress: '49.36.12.8' }),
        evt('payment.completed', 200, {
          ...TRUSTED_DEVICE,
          ...CITIES.vellore,
          amountUsd: 42.5,
          token: 'USDC',
          counterparty: 'kousthub@globalpay',
        }),
        evt('payment.completed', 150, {
          ...TRUSTED_DEVICE,
          ...CITIES.vellore,
          amountUsd: 18.0,
          token: 'USDC',
          counterparty: 'aditi@globalpay',
        }),
        evt('auth.login.success', 90, { ...TRUSTED_DEVICE, ...CITIES.vellore, ipAddress: '49.36.12.8' }),
        evt('payment.completed', 60, {
          ...TRUSTED_DEVICE,
          ...CITIES.vellore,
          amountUsd: 65.25,
          token: 'USDC',
          counterparty: 'kousthub@globalpay',
        }),
        evt('biometric.success', 30, { ...TRUSTED_DEVICE, ...CITIES.vellore }),
      ];
  }
}

/** Build a scenario and append it to the event log. */
export async function runScenario(
  scenario: ScenarioId,
  target: SimulationTarget,
): Promise<number> {
  const events = buildScenario(scenario, target);
  await recordEvents(events);
  return events.length;
}
