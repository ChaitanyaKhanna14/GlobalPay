/**
 * Explainable risk engine.
 *
 * Scores a candidate action (a login, a payment) against the user's own
 * history and returns both a number and the *reasons* behind it. Every factor
 * reports what it contributed and why, so the SOC can render a breakdown
 * instead of an unexplained verdict — the difference between a model an
 * examiner will trust and a black box they will not.
 *
 * ── Why this is a rules-based ensemble, not a neural network ──
 * Financial regulators require adverse decisions (a blocked payment) to be
 * explainable, and a fraud model trained on a student project's synthetic data
 * would be worse *and* less defensible than transparent weighted heuristics.
 * Each factor here is an independent detector with a bounded contribution;
 * the score is their sum, clamped to 100. That is the same additive,
 * per-feature-attribution shape SHAP produces for a tree model — so if a
 * trained model is added later, the RiskFactor[] contract does not change.
 *
 * ── Purity ──
 * No imports from React, storage, or native modules. Given the same inputs it
 * always returns the same output, which makes it unit-testable and lets it be
 * lifted into a Supabase Edge Function verbatim. That matters: scoring on the
 * client is a demo affordance, and an attacker controls their own client.
 */
import type {
  EventContext,
  RiskAssessment,
  RiskBand,
  RiskDecision,
  RiskFactor,
  SecurityEvent,
} from '@/types/security';

// ─── Tunables ───────────────────────────────────
/** Above this implied speed between two logins, travel is physically impossible. */
const IMPOSSIBLE_SPEED_KMH = 900; // faster than a commercial airliner
const FAILED_AUTH_WINDOW_MS = 15 * 60 * 1000;
const VELOCITY_WINDOW_MS = 10 * 60 * 1000;
const VELOCITY_THRESHOLD = 3; // payments in the window before this fires
const ODD_HOUR_START = 1;
const ODD_HOUR_END = 5;
/** How long a device must have been in use before it counts as established. */
const DEVICE_TRUST_WINDOW_MS = 24 * 60 * 60 * 1000;

const WEIGHTS = {
  newDevice: 20,
  impossibleTravel: 30,
  ipReputation: 15,
  failedAuthBurst: 25,
  paymentVelocity: 20,
  amountAnomaly: 25,
  oddHour: 10,
  newCounterparty: 12,
} as const;

export interface RiskInput {
  /** What is being attempted. */
  action: 'login' | 'payment' | 'key_export' | 'account_change';
  userId: string;
  context: EventContext;
  /** When the action occurs. Defaults to now. */
  at?: Date;
}

// ─── Geo helpers ────────────────────────────────
function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in kilometres. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ─── Factor helpers ─────────────────────────────
function factor(
  id: string,
  label: string,
  maxContribution: number,
  triggered: boolean,
  contribution: number,
  explanation: string,
): RiskFactor {
  return {
    id,
    label,
    maxContribution,
    triggered,
    contribution: triggered ? Math.round(contribution) : 0,
    explanation,
  };
}

function isAuthFailure(e: SecurityEvent): boolean {
  return (
    e.type === 'auth.login.failure' ||
    e.type === 'auth.mfa.failure' ||
    e.type === 'pin.failure' ||
    e.type === 'biometric.failure'
  );
}

// ─── The engine ─────────────────────────────────
export function assessRisk(input: RiskInput, history: SecurityEvent[]): RiskAssessment {
  const now = input.at ?? new Date();
  const nowMs = now.getTime();
  const ctx = input.context;
  /**
   * Only events that occurred *before* the action count as history. Scoring
   * against the full log would let the action being judged — and anything the
   * attacker did after it — vouch for itself: the attacker's device would
   * already look "known" and their payee already "seen", collapsing the score
   * to zero for exactly the incidents that matter most.
   */
  const mine = history.filter(
    (e) => e.userId === input.userId && new Date(e.timestamp).getTime() < nowMs,
  );
  const factors: RiskFactor[] = [];

  // 1 ─ Unrecognised device
  //
  // A device counts as established only once it has history older than the
  // trust window. Treating "seen at least once" as trusted would be trivially
  // defeated: an attacker's very first event registers their device, and every
  // action after it looks familiar.
  const firstSeen = new Map<string, number>();
  for (const e of mine) {
    const id = e.context.deviceId;
    if (!id) continue;
    const ts = new Date(e.timestamp).getTime();
    firstSeen.set(id, Math.min(firstSeen.get(id) ?? ts, ts));
  }
  const establishedDevices = new Set(
    [...firstSeen.entries()]
      .filter(([, seen]) => nowMs - seen >= DEVICE_TRUST_WINDOW_MS)
      .map(([id]) => id),
  );
  const isNewDevice =
    !!ctx.deviceId && establishedDevices.size > 0 && !establishedDevices.has(ctx.deviceId);
  factors.push(
    factor(
      'new_device',
      'Unrecognised device',
      WEIGHTS.newDevice,
      isNewDevice,
      WEIGHTS.newDevice,
      isNewDevice
        ? `Device "${ctx.deviceName ?? ctx.deviceId}" has no established history on this account${
            firstSeen.has(ctx.deviceId!)
              ? ` — first seen only ${Math.round((nowMs - firstSeen.get(ctx.deviceId!)!) / 60000)} minute(s) ago`
              : ''
          }. ${establishedDevices.size} device(s) are established.`
        : 'Action originates from a device with established history on this account.',
    ),
  );

  // 2 ─ Impossible travel
  const lastGeo = [...mine]
    .reverse()
    .find((e) => e.context.lat != null && e.context.lon != null && e.context.city);
  let impossible = false;
  let travelDetail = 'No prior geolocated activity to compare against.';
  if (lastGeo && ctx.lat != null && ctx.lon != null) {
    const km = haversineKm(lastGeo.context.lat!, lastGeo.context.lon!, ctx.lat, ctx.lon);
    const hours = Math.max(
      (nowMs - new Date(lastGeo.timestamp).getTime()) / 3_600_000,
      1 / 60, // floor at one minute to avoid divide-by-zero blowing the speed up
    );
    const speed = km / hours;
    impossible = speed > IMPOSSIBLE_SPEED_KMH && km > 100;
    travelDetail = impossible
      ? `Previous activity was in ${lastGeo.context.city} ${hours < 1 ? `${Math.round(hours * 60)} minute(s)` : `${hours.toFixed(1)} hour(s)`} ago — ${Math.round(km)} km away. Implied travel speed ${Math.round(speed)} km/h exceeds the ${IMPOSSIBLE_SPEED_KMH} km/h plausibility threshold.`
      : `Travel from ${lastGeo.context.city} to ${ctx.city ?? 'current location'} (${Math.round(km)} km) is physically plausible.`;
  }
  factors.push(
    factor(
      'impossible_travel',
      'Impossible travel',
      WEIGHTS.impossibleTravel,
      impossible,
      WEIGHTS.impossibleTravel,
      travelDetail,
    ),
  );

  // 3 ─ IP reputation
  const badIp = !!ctx.ipReputationFlagged;
  factors.push(
    factor(
      'ip_reputation',
      'Anonymising network',
      WEIGHTS.ipReputation,
      badIp,
      WEIGHTS.ipReputation,
      badIp
        ? `Source IP ${ctx.ipAddress ?? ''} belongs to a known VPN, Tor exit node, or hosting provider.`.trim()
        : 'Source IP has no anonymising-network reputation hits.',
    ),
  );

  // 4 ─ Recent authentication failures (scaled: 3 failures ≈ half weight, 6+ ≈ full)
  const recentFailures = mine.filter(
    (e) => isAuthFailure(e) && nowMs - new Date(e.timestamp).getTime() < FAILED_AUTH_WINDOW_MS,
  ).length;
  const failureTriggered = recentFailures >= 3;
  factors.push(
    factor(
      'failed_auth_burst',
      'Recent authentication failures',
      WEIGHTS.failedAuthBurst,
      failureTriggered,
      Math.min(recentFailures / 6, 1) * WEIGHTS.failedAuthBurst,
      failureTriggered
        ? `${recentFailures} failed authentication attempts on this account in the last ${FAILED_AUTH_WINDOW_MS / 60000} minutes.`
        : `${recentFailures} failed authentication attempt(s) recently — below the alerting threshold.`,
    ),
  );

  // 5 ─ Payment velocity
  const recentPayments = mine.filter(
    (e) =>
      e.type.startsWith('payment.') &&
      nowMs - new Date(e.timestamp).getTime() < VELOCITY_WINDOW_MS,
  ).length;
  const velocityTriggered = input.action === 'payment' && recentPayments >= VELOCITY_THRESHOLD;
  factors.push(
    factor(
      'payment_velocity',
      'Payment velocity',
      WEIGHTS.paymentVelocity,
      velocityTriggered,
      Math.min(recentPayments / (VELOCITY_THRESHOLD * 2), 1) * WEIGHTS.paymentVelocity,
      velocityTriggered
        ? `${recentPayments} payments attempted in the last ${VELOCITY_WINDOW_MS / 60000} minutes — consistent with automated draining of an account.`
        : 'Payment frequency is within this account’s normal range.',
    ),
  );

  // 6 ─ Transaction amount anomaly, measured against this user's own baseline
  const priorAmounts = mine
    .map((e) => e.context.amountUsd)
    .filter((a): a is number => typeof a === 'number' && a > 0);
  let amountTriggered = false;
  let amountContribution = 0;
  let amountDetail = 'No transaction amount attached to this action.';
  if (input.action === 'payment' && ctx.amountUsd != null) {
    if (priorAmounts.length >= 3) {
      const mean = priorAmounts.reduce((s, a) => s + a, 0) / priorAmounts.length;
      const max = Math.max(...priorAmounts);
      const ratio = ctx.amountUsd / Math.max(mean, 1);
      amountTriggered = ctx.amountUsd > max * 2 || ratio > 5;
      amountContribution = Math.min(ratio / 10, 1) * WEIGHTS.amountAnomaly;
      amountDetail = amountTriggered
        ? `$${ctx.amountUsd.toFixed(2)} is ${ratio.toFixed(1)}× this account’s average transfer ($${mean.toFixed(2)}) and exceeds its previous maximum ($${max.toFixed(2)}).`
        : `$${ctx.amountUsd.toFixed(2)} is consistent with this account’s history (average $${mean.toFixed(2)}).`;
    } else {
      amountDetail = `Insufficient transaction history (${priorAmounts.length}) to establish an amount baseline.`;
    }
  }
  factors.push(
    factor(
      'amount_anomaly',
      'Transaction amount anomaly',
      WEIGHTS.amountAnomaly,
      amountTriggered,
      amountContribution,
      amountDetail,
    ),
  );

  // 7 ─ Odd hour
  const hour = now.getHours();
  const oddHour = hour >= ODD_HOUR_START && hour <= ODD_HOUR_END;
  factors.push(
    factor(
      'odd_hour',
      'Unusual hour',
      WEIGHTS.oddHour,
      oddHour,
      WEIGHTS.oddHour,
      oddHour
        ? `Action occurred at ${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} local time, inside the ${ODD_HOUR_START}–${ODD_HOUR_END} window associated with automated activity.`
        : 'Action occurred during normal waking hours.',
    ),
  );

  // 8 ─ First payment to this counterparty
  const knownCounterparties = new Set(
    mine.map((e) => e.context.counterparty).filter((c): c is string => !!c),
  );
  const newCounterparty =
    input.action === 'payment' &&
    !!ctx.counterparty &&
    knownCounterparties.size > 0 &&
    !knownCounterparties.has(ctx.counterparty);
  factors.push(
    factor(
      'new_counterparty',
      'First-time recipient',
      WEIGHTS.newCounterparty,
      newCounterparty,
      WEIGHTS.newCounterparty,
      newCounterparty
        ? `${ctx.counterparty} has never received a payment from this account.`
        : 'Recipient has prior payment history with this account.',
    ),
  );

  // ─── Aggregate ───
  const score = Math.min(
    100,
    Math.round(factors.reduce((sum, f) => sum + f.contribution, 0)),
  );
  const band = bandFor(score);

  return {
    score,
    band,
    decision: decisionFor(band),
    factors,
    summary: buildSummary(score, band, factors, input),
    assessedAt: now.toISOString(),
  };
}

export function bandFor(score: number): RiskBand {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function decisionFor(band: RiskBand): RiskDecision {
  switch (band) {
    case 'critical':
      return 'block';
    case 'high':
      return 'challenge';
    case 'medium':
      return 'monitor';
    default:
      return 'allow';
  }
}

const DECISION_TEXT: Record<RiskDecision, string> = {
  allow: 'Allowed without additional friction.',
  monitor: 'Allowed, but flagged for monitoring.',
  challenge: 'Step-up authentication required before this action may proceed.',
  block: 'Blocked pending manual review.',
};

/**
 * Compose the analyst-facing narrative. Deterministic template generation, not
 * a language model: an incident report must say exactly what the evidence
 * supports, and must read identically every time it is regenerated.
 */
function buildSummary(
  score: number,
  band: RiskBand,
  factors: RiskFactor[],
  input: RiskInput,
): string {
  const fired = factors
    .filter((f) => f.triggered)
    .sort((a, b) => b.contribution - a.contribution);

  if (!fired.length) {
    return `This ${input.action} scored ${score}/100 (${band} risk). No risk factors triggered. ${DECISION_TEXT[decisionFor(band)]}`;
  }

  const lead = fired
    .slice(0, 3)
    .map((f) => `${f.label.toLowerCase()} (+${f.contribution})`)
    .join(', ');

  return (
    `This ${input.action} scored ${score}/100 (${band} risk), driven primarily by ${lead}. ` +
    `${fired.length} of ${factors.length} risk factors triggered. ${DECISION_TEXT[decisionFor(band)]}`
  );
}
