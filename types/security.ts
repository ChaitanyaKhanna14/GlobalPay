/**
 * GlobalPay Secure — Security domain types
 *
 * These types define the vocabulary shared by every part of the security
 * layer: the event pipeline, the risk engine, the detection rules, the SOC
 * dashboard, and the blockchain audit anchor.
 *
 * Design intent: everything here is plain data. No React, no native modules,
 * no I/O. That keeps the risk engine and detection rules portable — the exact
 * same code can run in-app for the demo or inside a Supabase Edge Function
 * when scoring moves server-side (see docs/SECURITY-ARCHITECTURE.md).
 */

// ─── Severity ───────────────────────────────────
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// ─── Security Event Taxonomy ────────────────────
/**
 * Every security-relevant action in the app emits one of these. The string
 * form is `<domain>.<object>.<outcome>` so events group naturally in the SOC
 * and can be filtered by prefix (e.g. all `auth.*`).
 */
export type SecurityEventType =
  // Authentication
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.mfa.challenge'
  | 'auth.mfa.success'
  | 'auth.mfa.failure'
  | 'auth.password.change'
  | 'auth.password.reset_request'
  | 'auth.session.refresh'
  // Device & session
  | 'device.new'
  | 'device.trusted'
  | 'session.hijack_suspected'
  // App lock / PIN
  | 'pin.failure'
  | 'pin.lockout'
  | 'pin.success'
  | 'biometric.success'
  | 'biometric.failure'
  // Payments
  | 'payment.initiated'
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.blocked'
  | 'payment.challenged'
  // Wallet
  | 'wallet.created'
  | 'wallet.imported'
  | 'wallet.key_exported'
  // Account
  | 'account.profile_change'
  | 'account.email_change'
  | 'account.deleted'
  // Application-layer attacks
  | 'appsec.injection_attempt'
  | 'appsec.rate_limit_exceeded'
  | 'appsec.malformed_request';

/** Coarse grouping used for dashboard filters and charts. */
export type EventCategory =
  | 'authentication'
  | 'device'
  | 'payment'
  | 'wallet'
  | 'account'
  | 'appsec';

export function categoryOf(type: SecurityEventType): EventCategory {
  if (type.startsWith('auth.') || type.startsWith('pin.') || type.startsWith('biometric.')) {
    return 'authentication';
  }
  if (type.startsWith('device.') || type.startsWith('session.')) return 'device';
  if (type.startsWith('payment.')) return 'payment';
  if (type.startsWith('wallet.')) return 'wallet';
  if (type.startsWith('account.')) return 'account';
  return 'appsec';
}

/**
 * Contextual signals captured alongside an event. This is the raw material the
 * risk engine scores against — it is deliberately a flat, serialisable shape.
 */
export interface EventContext {
  /** Stable pseudonymous device fingerprint (never a hardware serial). */
  deviceId?: string;
  deviceName?: string;
  /** Coarse geo only — city/country, never precise coordinates. */
  city?: string;
  country?: string;
  /** Latitude/longitude of the *city centroid*, used for travel-speed maths. */
  lat?: number;
  lon?: number;
  ipAddress?: string;
  /** True when the IP belongs to a known VPN/Tor/hosting range. */
  ipReputationFlagged?: boolean;
  /** Payment-specific context. */
  amountUsd?: number;
  token?: string;
  counterparty?: string;
  /** Free-form detail for display; must not contain secrets. */
  detail?: string;
  /**
   * True when the event was produced by the attack simulator rather than by
   * real activity. The SOC labels these so a drill is never mistaken for an
   * actual incident.
   */
  simulated?: boolean;
}

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  category: EventCategory;
  severity: Severity;
  /** ISO-8601 UTC. */
  timestamp: string;
  /** Pseudonymous user reference. */
  userId: string;
  /** Display handle for the SOC feed (e.g. "nehan@globalpay"). */
  actor?: string;
  context: EventContext;
  /**
   * Hash-chain fields — each event commits to the one before it, so removing
   * or editing any event breaks every subsequent link. See event-log.ts.
   */
  prevHash: string;
  hash: string;
}

// ─── Risk Scoring ───────────────────────────────
export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

export type RiskDecision = 'allow' | 'monitor' | 'challenge' | 'block';

/**
 * One explainable contribution to a risk score. The SOC renders these directly,
 * which is what makes the scoring "explainable AI" rather than a black box.
 */
export interface RiskFactor {
  id: string;
  label: string;
  /** Points this factor contributed to the final score. */
  contribution: number;
  /** Maximum this factor could ever contribute — gives the bar a denominator. */
  maxContribution: number;
  /** Plain-English reason shown to an analyst. */
  explanation: string;
  /** True when the factor fired; false factors are shown greyed out. */
  triggered: boolean;
}

export interface RiskAssessment {
  /** 0–100. */
  score: number;
  band: RiskBand;
  decision: RiskDecision;
  factors: RiskFactor[];
  /** Generated natural-language summary for the incident report. */
  summary: string;
  assessedAt: string;
}

// ─── MITRE ATT&CK ───────────────────────────────
export interface MitreTechnique {
  id: string;        // e.g. "T1110.004"
  name: string;      // e.g. "Credential Stuffing"
  tactic: string;    // e.g. "Credential Access"
  url: string;
}

// ─── Detection & Alerts ─────────────────────────
export type AlertStatus = 'open' | 'investigating' | 'contained' | 'resolved' | 'false_positive';

export type DetectionRuleId =
  | 'credential_stuffing'
  | 'brute_force_pin'
  | 'impossible_travel'
  | 'account_takeover_chain'
  | 'payment_velocity'
  | 'large_transfer_anomaly'
  | 'new_device_high_value'
  | 'injection_attempt'
  | 'key_exfiltration';

export interface DetectionRule {
  id: DetectionRuleId;
  name: string;
  description: string;
  severity: Severity;
  mitre: MitreTechnique[];
  /** Analyst-facing remediation steps. */
  recommendations: string[];
}

export interface SecurityAlert {
  id: string;
  ruleId: DetectionRuleId;
  ruleName: string;
  severity: Severity;
  status: AlertStatus;
  userId: string;
  actor?: string;
  /** When the correlated behaviour was detected. */
  detectedAt: string;
  /** Events that caused this alert to fire — the evidence trail. */
  evidence: SecurityEvent[];
  mitre: MitreTechnique[];
  /** Risk assessment attached at detection time, when applicable. */
  risk?: RiskAssessment;
  /** Generated incident narrative. */
  explanation: string;
  recommendations: string[];
}

// ─── Blockchain Audit Anchor ────────────────────
export type AnchorStatus = 'pending' | 'anchored' | 'failed';

/**
 * A batch of security events committed to the blockchain as a single Merkle
 * root. We anchor *hashes only* — never event contents, never PII. The chain
 * gives integrity and non-repudiation; confidentiality stays with TLS and
 * encrypted storage.
 */
export interface AuditAnchor {
  id: string;
  merkleRoot: string;
  /** Number of events covered by this root. */
  eventCount: number;
  /** ISO timestamps bounding the batch. */
  fromTimestamp: string;
  toTimestamp: string;
  createdAt: string;
  status: AnchorStatus;
  /** Polygon transaction hash once anchored. */
  txHash?: string;
  chainId?: number;
  explorerUrl?: string;
  error?: string;
}

export type IntegrityStatus = 'verified' | 'tampered' | 'unanchored';

export interface IntegrityReport {
  status: IntegrityStatus;
  checkedAt: string;
  eventsChecked: number;
  /** Index of the first event whose hash chain does not reconcile. */
  brokenAtIndex?: number;
  brokenEventId?: string;
  /** Recomputed vs anchored Merkle root. */
  computedRoot?: string;
  anchoredRoot?: string;
  message: string;
}

// ─── SOC Dashboard ──────────────────────────────
export interface SocMetrics {
  totalEvents: number;
  eventsLast24h: number;
  openAlerts: number;
  criticalAlerts: number;
  highRiskEvents: number;
  blockedPayments: number;
  meanRiskScore: number;
  integrity: IntegrityStatus;
  lastAnchoredAt?: string;
}
