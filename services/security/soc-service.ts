/**
 * SOC service — the facade the UI talks to.
 *
 * Everything below this line is pure logic (risk engine, detection rules,
 * Merkle anchoring). This module is where those pieces are composed and where
 * the app's own actions get translated into security events. Screens import
 * from here and nothing deeper.
 */
import {
  loadEvents,
  recordEvent,
  getEventsSync,
  subscribeToEvents,
  verifyChain,
  clearEvents,
  type RecordEventInput,
} from './event-log';
import { runDetections } from './detection-rules';
import { assessRisk, type RiskInput } from './risk-engine';
import {
  anchorEvents,
  compareRoots,
  latestAnchor,
  loadAnchors,
  clearAnchors,
  type AnchorMode,
} from './blockchain-anchor';
import { runScenario, type ScenarioId, type SimulationTarget } from './attack-simulator';
import {
  clearTriage,
  getTriageSync,
  isActive,
  loadTriage,
} from './alert-status';
import type {
  IntegrityReport,
  RiskAssessment,
  SecurityAlert,
  SecurityEvent,
  SocMetrics,
} from '@/types/security';

// Re-export the pieces screens legitimately need, so they never reach past this facade.
export { SCENARIOS, type ScenarioId } from './attack-simulator';
export { RULES } from './detection-rules';
export { ALL_TECHNIQUES, techniquesByTactic } from './mitre';
export { subscribeToEvents, loadEvents, getEventsSync } from './event-log';
export { loadAnchors, latestAnchor } from './blockchain-anchor';
export {
  allowedTransitions,
  isActive,
  loadTriage,
  setAlertStatus,
  STATUS_LABEL,
  subscribeToTriage,
  triageFor,
} from './alert-status';

// ─── Event recording ────────────────────────────

/**
 * Record a security event. Thin passthrough today, but the single choke point
 * where forwarding to a server-side SIEM would be added.
 */
export async function logSecurityEvent(input: RecordEventInput): Promise<SecurityEvent> {
  return recordEvent(input);
}

// ─── Risk ───────────────────────────────────────

/** Score an action against the user's own event history. */
export async function scoreAction(input: RiskInput): Promise<RiskAssessment> {
  const history = await loadEvents();
  return assessRisk(input, history);
}

/** Synchronous variant for render paths where the log is already loaded. */
export function scoreActionSync(input: RiskInput): RiskAssessment {
  return assessRisk(input, getEventsSync());
}

// ─── Detections ─────────────────────────────────

/**
 * Overlay analyst triage onto the freshly derived alerts.
 *
 * Detections are recomputed from the event log every time, so the status an
 * analyst set has to be re-attached here rather than living on the alert.
 */
function withTriage(alerts: SecurityAlert[]): SecurityAlert[] {
  const triage = getTriageSync();
  return alerts.map((alert) =>
    triage[alert.id] ? { ...alert, status: triage[alert.id].status } : alert,
  );
}

export async function getAlerts(): Promise<SecurityAlert[]> {
  const [events] = await Promise.all([loadEvents(), loadTriage()]);
  return withTriage(runDetections(events));
}

export function getAlertsSync(): SecurityAlert[] {
  return withTriage(runDetections(getEventsSync()));
}

// ─── Integrity ──────────────────────────────────

/**
 * Two-part integrity check:
 *   1. the local hash chain still reconciles (nothing edited or removed), and
 *   2. the recomputed Merkle root still matches what was anchored.
 *
 * Step 1 alone catches a careless edit. Step 2 is what catches an attacker who
 * edited an event *and* recomputed every subsequent hash to cover their tracks —
 * because they cannot also rewrite the anchored root.
 */
export async function checkIntegrity(): Promise<IntegrityReport> {
  const events = await loadEvents();
  const chain = verifyChain(events);
  const checkedAt = new Date().toISOString();

  if (!chain.valid) {
    const broken = chain.brokenAtIndex != null ? events[chain.brokenAtIndex] : undefined;
    return {
      status: 'tampered',
      checkedAt,
      eventsChecked: chain.checked,
      brokenAtIndex: chain.brokenAtIndex,
      brokenEventId: chain.brokenEventId,
      message:
        `Hash chain verification FAILED at event ${(chain.brokenAtIndex ?? 0) + 1} of ${chain.checked}` +
        `${broken ? ` (${broken.type})` : ''}. The recomputed digest does not match the stored one, ` +
        `which means this event — or one before it — was altered after being written.`,
    };
  }

  const anchor = await latestAnchor();
  if (!anchor) {
    return {
      status: 'unanchored',
      checkedAt,
      eventsChecked: chain.checked,
      message:
        `Local hash chain is intact across all ${chain.checked} event(s), but no Merkle root has been ` +
        `anchored yet. Anchoring adds proof that the chain head itself was not rewritten.`,
    };
  }

  const { matches, computedRoot, anchoredRoot } = compareRoots(events, anchor);
  return {
    status: matches ? 'verified' : 'tampered',
    checkedAt,
    eventsChecked: chain.checked,
    computedRoot,
    anchoredRoot,
    message: matches
      ? `Integrity verified. All ${chain.checked} event(s) hash-reconcile, and the recomputed Merkle ` +
        `root matches the root anchored at ${new Date(anchor.createdAt).toLocaleString()}` +
        `${anchor.txHash ? ` in transaction ${anchor.txHash.slice(0, 14)}…` : ''}.`
      : `Integrity check FAILED. The hash chain is internally consistent, but the recomputed Merkle ` +
        `root (${computedRoot.slice(0, 18)}…) does not match the anchored root ` +
        `(${anchoredRoot.slice(0, 18)}…). Events covered by that anchor have been added, removed, or ` +
        `rewritten since it was taken.`,
  };
}

/** Anchor every event currently in the log. */
export async function anchorNow(
  mode: AnchorMode = 'local',
  submitOnChain?: (root: string) => Promise<string>,
) {
  const events = await loadEvents();
  return anchorEvents(events, mode, submitOnChain);
}

// ─── Metrics ────────────────────────────────────

export function computeMetrics(
  events: SecurityEvent[],
  alerts: SecurityAlert[],
  integrity: IntegrityReport | null,
): SocMetrics {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => new Date(e.timestamp).getTime() >= dayAgo);

  // "Open" means still demanding attention — resolved and false-positive
  // alerts drop out of the count, which is the whole point of triage.
  const openAlerts = alerts.filter((a) => isActive(a.status));
  const highRiskEvents = events.filter(
    (e) => e.severity === 'high' || e.severity === 'critical',
  );

  // Mean risk is approximated from event severity so the tile stays meaningful
  // without re-scoring every historical event on each render.
  const severityScore: Record<string, number> = {
    info: 5,
    low: 20,
    medium: 45,
    high: 70,
    critical: 92,
  };
  const meanRiskScore = events.length
    ? Math.round(
        events.reduce((sum, e) => sum + (severityScore[e.severity] ?? 0), 0) / events.length,
      )
    : 0;

  return {
    totalEvents: events.length,
    eventsLast24h: recent.length,
    openAlerts: openAlerts.length,
    criticalAlerts: alerts.filter((a) => a.severity === 'critical').length,
    highRiskEvents: highRiskEvents.length,
    blockedPayments: events.filter((e) => e.type === 'payment.blocked').length,
    meanRiskScore,
    integrity: integrity?.status ?? 'unanchored',
  };
}

// ─── Simulation ─────────────────────────────────

export async function simulate(
  scenario: ScenarioId,
  target: SimulationTarget,
): Promise<number> {
  return runScenario(scenario, target);
}

/** Reset the SOC to an empty state. Demo convenience. */
export async function resetSecurityData(): Promise<void> {
  await clearEvents();
  await clearAnchors();
  await clearTriage();
}
