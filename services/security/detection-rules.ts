/**
 * Detection rules — the correlation layer.
 *
 * The risk engine scores a *single* action. These rules look across the event
 * stream for patterns that only become visible in aggregate: forty failed
 * logins in three minutes, or a login followed by a password change followed by
 * a large transfer. That distinction (point-in-time scoring vs. temporal
 * correlation) is the same split a real SIEM makes between risk-based
 * authentication and detection content.
 *
 * Every rule declares its MITRE ATT&CK mapping and its remediation steps, so a
 * fired alert arrives with the context an analyst needs to act.
 */
import type {
  DetectionRule,
  DetectionRuleId,
  SecurityAlert,
  SecurityEvent,
} from '@/types/security';
import { MITRE } from './mitre';

// ─── Rule catalogue ─────────────────────────────
export const RULES: Record<DetectionRuleId, DetectionRule> = {
  credential_stuffing: {
    id: 'credential_stuffing',
    name: 'Credential Stuffing',
    description:
      'A high volume of failed logins in a short window, characteristic of an attacker replaying breached username/password pairs.',
    severity: 'critical',
    mitre: [MITRE.CREDENTIAL_STUFFING, MITRE.BRUTE_FORCE],
    recommendations: [
      'Block the originating IP range at the edge',
      'Force a password reset on the targeted account',
      'Require MFA on the next successful sign-in',
      'Check whether the credentials appear in a known breach corpus',
    ],
  },
  brute_force_pin: {
    id: 'brute_force_pin',
    name: 'PIN Brute Force',
    description:
      'Repeated incorrect app-lock PIN entries, indicating an attacker with physical or remote control of the device.',
    severity: 'high',
    mitre: [MITRE.BRUTE_FORCE, MITRE.PASSWORD_GUESSING],
    recommendations: [
      'Confirm the progressive lockout engaged',
      'Notify the account owner out-of-band',
      'Require biometric re-enrolment before unlocking',
    ],
  },
  impossible_travel: {
    id: 'impossible_travel',
    name: 'Impossible Travel',
    description:
      'Two authenticated sessions from locations too far apart to be reached in the elapsed time — one of the sessions is not the legitimate user.',
    severity: 'high',
    mitre: [MITRE.VALID_ACCOUNTS, MITRE.STEAL_SESSION_COOKIE],
    recommendations: [
      'Invalidate all active sessions for the account',
      'Force re-authentication with MFA',
      'Review any transactions made from the anomalous location',
    ],
  },
  account_takeover_chain: {
    id: 'account_takeover_chain',
    name: 'Account Takeover Sequence',
    description:
      'The canonical ATO kill chain: sign-in from an unrecognised device, followed by a credential or contact-detail change, followed by an outbound transfer.',
    severity: 'critical',
    mitre: [MITRE.VALID_ACCOUNTS, MITRE.ACCOUNT_MANIPULATION, MITRE.FINANCIAL_THEFT],
    recommendations: [
      'Freeze the account immediately',
      'Reverse or hold any pending transfers',
      'Restore the original recovery email and phone number',
      'Contact the account owner through a previously verified channel',
    ],
  },
  payment_velocity: {
    id: 'payment_velocity',
    name: 'Payment Velocity Anomaly',
    description:
      'An unusually rapid sequence of outbound payments, consistent with automated draining of a compromised wallet.',
    severity: 'high',
    mitre: [MITRE.FINANCIAL_THEFT],
    recommendations: [
      'Apply a temporary outbound transfer limit',
      'Require step-up authentication per transaction',
      'Review destination addresses for a common beneficiary',
    ],
  },
  large_transfer_anomaly: {
    id: 'large_transfer_anomaly',
    name: 'Large Transfer Anomaly',
    description:
      'A transfer far outside the account’s established amount baseline.',
    severity: 'medium',
    mitre: [MITRE.FINANCIAL_THEFT],
    recommendations: [
      'Hold the transfer for manual review',
      'Confirm intent with the account owner',
    ],
  },
  new_device_high_value: {
    id: 'new_device_high_value',
    name: 'High-Value Transfer from New Device',
    description:
      'A significant transfer initiated from a device with no prior history on the account.',
    severity: 'high',
    mitre: [MITRE.VALID_ACCOUNTS, MITRE.FINANCIAL_THEFT],
    recommendations: [
      'Require step-up authentication before releasing the transfer',
      'Add the device to the review queue rather than auto-trusting it',
    ],
  },
  injection_attempt: {
    id: 'injection_attempt',
    name: 'Injection Attempt',
    description:
      'Input containing SQL, NoSQL, or script injection syntax reached a server-side parameter.',
    severity: 'critical',
    mitre: [MITRE.EXPLOIT_PUBLIC_APP],
    recommendations: [
      'Confirm the query used parameterised bindings',
      'Block the source IP',
      'Review adjacent requests from the same session for successful exploitation',
    ],
  },
  key_exfiltration: {
    id: 'key_exfiltration',
    name: 'Private Key Export',
    description:
      'A wallet private key or recovery phrase was exported. Legitimate during backup, catastrophic during a takeover.',
    severity: 'critical',
    mitre: [MITRE.CREDENTIALS_FROM_PASSWORD_STORES, MITRE.UNSECURED_CREDENTIALS, MITRE.EXFIL_OVER_C2],
    recommendations: [
      'Verify the export was initiated by the account owner',
      'If unverified, treat the wallet as fully compromised and migrate funds',
      'Confirm the export was gated behind biometric or PIN authentication',
    ],
  },
};

// ─── Tunables ───────────────────────────────────
const CRED_STUFFING_WINDOW_MS = 5 * 60 * 1000;
const CRED_STUFFING_THRESHOLD = 10;
const PIN_BRUTE_WINDOW_MS = 10 * 60 * 1000;
const PIN_BRUTE_THRESHOLD = 5;
const ATO_CHAIN_WINDOW_MS = 30 * 60 * 1000;
const VELOCITY_WINDOW_MS = 10 * 60 * 1000;
const VELOCITY_THRESHOLD = 5;
const HIGH_VALUE_USD = 500;

/**
 * Alert IDs are derived from the rule plus the first piece of evidence rather
 * than randomised. Detections are recomputed from the event log on every read,
 * so a random ID would change identity on each pass — breaking deep links into
 * an incident and making status tracking impossible. Deriving the ID keeps it
 * stable for as long as the underlying evidence exists.
 */
function alertId(rule: DetectionRule, evidence: SecurityEvent[]): string {
  return `alt_${rule.id}_${evidence[0]?.id ?? 'none'}`;
}

function ms(event: SecurityEvent): number {
  return new Date(event.timestamp).getTime();
}

function buildAlert(
  rule: DetectionRule,
  evidence: SecurityEvent[],
  explanation: string,
): SecurityAlert {
  const latest = evidence[evidence.length - 1];
  return {
    id: alertId(rule, evidence),
    ruleId: rule.id,
    ruleName: rule.name,
    severity: rule.severity,
    status: 'open',
    userId: latest.userId,
    actor: latest.actor,
    detectedAt: latest.timestamp,
    evidence,
    mitre: rule.mitre,
    explanation,
    recommendations: rule.recommendations,
  };
}

/** Group events by user so rules reason about one account at a time. */
function byUser(events: SecurityEvent[]): Map<string, SecurityEvent[]> {
  const map = new Map<string, SecurityEvent[]>();
  for (const e of events) {
    const bucket = map.get(e.userId);
    if (bucket) {
      bucket.push(e);
    } else {
      map.set(e.userId, [e]);
    }
  }
  return map;
}

/**
 * Run every rule over the event stream and return the alerts that fire.
 *
 * Deterministic and side-effect free: the same events always produce the same
 * alerts, which is what makes the SOC reproducible during a demo.
 */
export function runDetections(events: SecurityEvent[]): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  const sorted = [...events].sort((a, b) => ms(a) - ms(b));

  for (const [, userEvents] of byUser(sorted)) {
    alerts.push(...detectCredentialStuffing(userEvents));
    alerts.push(...detectPinBruteForce(userEvents));
    alerts.push(...detectImpossibleTravel(userEvents));
    alerts.push(...detectAtoChain(userEvents));
    alerts.push(...detectPaymentVelocity(userEvents));
    alerts.push(...detectNewDeviceHighValue(userEvents));
  }

  // These are per-event rules, not per-user correlations.
  alerts.push(...detectInjection(sorted));
  alerts.push(...detectKeyExport(sorted));

  return alerts.sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
}

// ─── Individual detections ──────────────────────

function detectCredentialStuffing(events: SecurityEvent[]): SecurityAlert[] {
  const failures = events.filter((e) => e.type === 'auth.login.failure');
  if (failures.length < CRED_STUFFING_THRESHOLD) return [];

  // Sliding window: find the densest burst rather than alerting per failure.
  for (let i = 0; i + CRED_STUFFING_THRESHOLD - 1 < failures.length; i++) {
    const window = failures.slice(i, i + CRED_STUFFING_THRESHOLD);
    const span = ms(window[window.length - 1]) - ms(window[0]);
    if (span > CRED_STUFFING_WINDOW_MS) continue;

    // Extend the window to include every failure in the same burst.
    let end = i + CRED_STUFFING_THRESHOLD;
    while (end < failures.length && ms(failures[end]) - ms(window[0]) <= CRED_STUFFING_WINDOW_MS) {
      end++;
    }
    const burst = failures.slice(i, end);
    const ips = new Set(burst.map((e) => e.context.ipAddress).filter(Boolean));
    const flagged = burst.some((e) => e.context.ipReputationFlagged);

    return [
      buildAlert(
        RULES.credential_stuffing,
        burst,
        `${burst.length} failed sign-in attempts were recorded within ${Math.max(
          1,
          Math.round((ms(burst[burst.length - 1]) - ms(burst[0])) / 1000),
        )} seconds, originating from ${ips.size} distinct IP address(es)${
          flagged ? ', at least one of which is a known anonymising network' : ''
        }. The request rate is far beyond human typing speed and the pattern — many attempts, no successes — matches credential stuffing rather than a user who has forgotten their password.`,
      ),
    ];
  }
  return [];
}

function detectPinBruteForce(events: SecurityEvent[]): SecurityAlert[] {
  const failures = events.filter((e) => e.type === 'pin.failure');
  if (failures.length < PIN_BRUTE_THRESHOLD) return [];

  const recent = failures.slice(-PIN_BRUTE_THRESHOLD);
  if (ms(recent[recent.length - 1]) - ms(recent[0]) > PIN_BRUTE_WINDOW_MS) return [];

  const lockout = events.find((e) => e.type === 'pin.lockout');
  return [
    buildAlert(
      RULES.brute_force_pin,
      lockout ? [...recent, lockout] : recent,
      `${recent.length} consecutive incorrect app-lock PIN entries were recorded. ${
        lockout
          ? 'The progressive lockout engaged and further attempts are being refused.'
          : 'The account is approaching the lockout threshold.'
      } Repeated PIN failures indicate someone other than the owner is in possession of an unlocked device.`,
    ),
  ];
}

function detectImpossibleTravel(events: SecurityEvent[]): SecurityAlert[] {
  const logins = events.filter(
    (e) => e.type === 'auth.login.success' && e.context.lat != null && e.context.lon != null,
  );
  const alerts: SecurityAlert[] = [];

  for (let i = 1; i < logins.length; i++) {
    const prev = logins[i - 1];
    const curr = logins[i];
    const km = haversine(
      prev.context.lat!,
      prev.context.lon!,
      curr.context.lat!,
      curr.context.lon!,
    );
    const hours = Math.max((ms(curr) - ms(prev)) / 3_600_000, 1 / 60);
    const speed = km / hours;

    if (speed > 900 && km > 100) {
      alerts.push(
        buildAlert(
          RULES.impossible_travel,
          [prev, curr],
          `A session was established in ${curr.context.city ?? 'an unknown city'} ${
            hours < 1 ? `${Math.round(hours * 60)} minutes` : `${hours.toFixed(1)} hours`
          } after a session in ${prev.context.city ?? 'an unknown city'} — a separation of ${Math.round(
            km,
          )} km. Covering that distance in the elapsed time would require travelling at ${Math.round(
            speed,
          )} km/h. Both sessions authenticated successfully, so the credentials are valid in both places: one of these sessions belongs to an attacker.`,
        ),
      );
    }
  }
  return alerts;
}

function detectAtoChain(events: SecurityEvent[]): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];

  const newDeviceLogins = events.filter(
    (e) => e.type === 'auth.login.success' || e.type === 'device.new',
  );

  for (const login of newDeviceLogins) {
    const windowEnd = ms(login) + ATO_CHAIN_WINDOW_MS;
    const after = events.filter((e) => ms(e) > ms(login) && ms(e) <= windowEnd);

    const change = after.find(
      (e) => e.type === 'auth.password.change' || e.type === 'account.email_change',
    );
    if (!change) continue;

    const transfer = after.find(
      (e) =>
        ms(e) > ms(change) &&
        (e.type === 'payment.initiated' || e.type === 'payment.completed'),
    );
    if (!transfer) continue;

    alerts.push(
      buildAlert(
        RULES.account_takeover_chain,
        [login, change, transfer],
        `A complete account-takeover sequence executed within ${Math.round(
          (ms(transfer) - ms(login)) / 60000,
        )} minutes: sign-in from ${
          login.context.deviceName ?? 'an unrecognised device'
        }${login.context.city ? ` in ${login.context.city}` : ''}, followed by a ${
          change.type === 'auth.password.change' ? 'password change' : 'recovery email change'
        }, followed by an outbound transfer${
          transfer.context.amountUsd ? ` of $${transfer.context.amountUsd.toFixed(2)}` : ''
        }. Changing the credential first locks the legitimate owner out of the recovery path before the funds move — the ordering is what distinguishes this from routine account maintenance.`,
      ),
    );
    break; // one chain alert per account is enough; they describe the same incident
  }
  return alerts;
}

function detectPaymentVelocity(events: SecurityEvent[]): SecurityAlert[] {
  const payments = events.filter(
    (e) => e.type === 'payment.initiated' || e.type === 'payment.completed',
  );
  if (payments.length < VELOCITY_THRESHOLD) return [];

  for (let i = 0; i + VELOCITY_THRESHOLD - 1 < payments.length; i++) {
    const window = payments.slice(i, i + VELOCITY_THRESHOLD);
    const span = ms(window[window.length - 1]) - ms(window[0]);
    if (span > VELOCITY_WINDOW_MS) continue;

    const total = window.reduce((sum, e) => sum + (e.context.amountUsd ?? 0), 0);
    return [
      buildAlert(
        RULES.payment_velocity,
        window,
        `${window.length} outbound payments totalling $${total.toFixed(2)} were initiated within ${Math.round(
          span / 60000,
        )} minute(s). Rapid sequential transfers are the signature of an attacker moving funds out before the owner notices, rather than of normal spending.`,
      ),
    ];
  }
  return [];
}

function detectNewDeviceHighValue(events: SecurityEvent[]): SecurityAlert[] {
  const knownDevices = new Set<string>();
  const alerts: SecurityAlert[] = [];

  for (const e of events) {
    const device = e.context.deviceId;
    const amount = e.context.amountUsd ?? 0;

    if (
      device &&
      knownDevices.size > 0 &&
      !knownDevices.has(device) &&
      (e.type === 'payment.initiated' || e.type === 'payment.completed') &&
      amount >= HIGH_VALUE_USD
    ) {
      alerts.push(
        buildAlert(
          RULES.new_device_high_value,
          [e],
          `A transfer of $${amount.toFixed(2)} was initiated from ${
            e.context.deviceName ?? 'a device'
          } that has no prior history on this account. High-value movement from an unestablished device is a standard takeover indicator and should not clear without step-up authentication.`,
        ),
      );
    }
    if (device) knownDevices.add(device);
  }
  return alerts;
}

function detectInjection(events: SecurityEvent[]): SecurityAlert[] {
  return events
    .filter((e) => e.type === 'appsec.injection_attempt')
    .map((e) =>
      buildAlert(
        RULES.injection_attempt,
        [e],
        `Input containing injection syntax was submitted to a server-side parameter${
          e.context.detail ? `: ${e.context.detail}` : ''
        }. The request was rejected by input validation before reaching the data layer, and all database access uses parameterised queries — but the attempt confirms the endpoint is being actively probed.`,
      ),
    );
}

function detectKeyExport(events: SecurityEvent[]): SecurityAlert[] {
  return events
    .filter((e) => e.type === 'wallet.key_exported')
    .map((e) =>
      buildAlert(
        RULES.key_exfiltration,
        [e],
        `A wallet private key or recovery phrase was exported from ${
          e.context.deviceName ?? 'a device'
        }${e.context.city ? ` in ${e.context.city}` : ''}. Because GlobalPay wallets are non-custodial, whoever holds this key holds the funds outright and no server-side control can claw them back. Verify the owner initiated this.`,
      ),
    );
}

// Local copy so this module stays independent of the risk engine.
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
