/**
 * Incident report — the detail view behind a SOC alert.
 *
 * Answers the four questions an analyst asks on opening an alert: what
 * happened, how do we know, how bad is it, and what do we do about it. The
 * risk breakdown is rendered factor by factor so the score is auditable rather
 * than asserted.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { GP } from '@/constants/colors';
import {
  BAND_COLOR,
  Card,
  FactorBar,
  RiskMeter,
  SectionTitle,
  SeverityBadge,
  SEVERITY_COLOR,
  socContentStyle,
  formatEventTime,
} from '@/components/soc/primitives';
import {
  allowedTransitions,
  getAlertsSync,
  loadEvents,
  loadTriage,
  scoreActionSync,
  setAlertStatus,
  STATUS_LABEL,
  triageFor,
} from '@/services/security/soc-service';
import type { AlertStatus, RiskAssessment, SecurityAlert } from '@/types/security';

export default function IncidentReport() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { alertId } = useLocalSearchParams<{ alertId: string }>();

  const [ready, setReady] = useState(false);
  const [alert, setAlert] = useState<SecurityAlert | undefined>();

  /**
   * Re-derive this alert from the event log plus current triage state.
   *
   * Deliberately explicit rather than a useMemo keyed on a revision counter:
   * this project builds with the React Compiler enabled (see app.config.ts),
   * and a dependency listed but never *read* inside the memo body gets
   * optimised away — so the recomputation silently never fired and a status
   * change persisted to storage without ever reaching the screen.
   */
  const refreshAlert = useCallback(() => {
    const id = decodeURIComponent(String(alertId ?? ''));
    setAlert(getAlertsSync().find((a) => a.id === id));
  }, [alertId]);

  useEffect(() => {
    Promise.all([loadEvents(), loadTriage()]).then(() => {
      refreshAlert();
      setReady(true);
    });
  }, [refreshAlert]);

  const handleStatusChange = async (next: AlertStatus) => {
    if (!alert) return;
    await setAlertStatus(alert.id, next);
    refreshAlert();
  };

  // ─── Attack replay ───
  // Steps through the evidence one event at a time. The sequence is what makes
  // a takeover legible — a login, then a credential change, then a transfer
  // reads as an attack in a way the same three events shown at once do not.
  const [replayStep, setReplayStep] = useState<number | null>(null);
  const replayTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopReplay = useCallback(() => {
    if (replayTimer.current) {
      clearInterval(replayTimer.current);
      replayTimer.current = null;
    }
    setReplayStep(null);
  }, []);

  // Never leave a timer running behind a screen the user has left.
  useEffect(() => stopReplay, [stopReplay]);

  const toggleReplay = () => {
    if (replayStep !== null) {
      stopReplay();
      return;
    }
    const total = alert?.evidence.length ?? 0;
    if (total === 0) return;

    setReplayStep(0);
    replayTimer.current = setInterval(() => {
      setReplayStep((step) => {
        if (step === null) return null;
        if (step + 1 >= total) {
          // Finished — hold the completed timeline on screen rather than
          // snapping back, so the final state stays readable.
          if (replayTimer.current) {
            clearInterval(replayTimer.current);
            replayTimer.current = null;
          }
          return total - 1;
        }
        return step + 1;
      });
    }, 1100);
  };

  /**
   * Score the alert's most recent piece of evidence. Reusing the live risk
   * engine here — rather than storing a score at detection time — means the
   * report always reflects the current model, and the factor breakdown shown
   * is provably the one that produced the number.
   */
  const risk = useMemo<RiskAssessment | null>(() => {
    if (!alert) return null;
    const trigger = alert.evidence[alert.evidence.length - 1];
    const action = trigger.type.startsWith('payment.')
      ? 'payment'
      : trigger.type === 'wallet.key_exported'
        ? 'key_export'
        : trigger.type.startsWith('account.')
          ? 'account_change'
          : 'login';

    return scoreActionSync({
      action,
      userId: trigger.userId,
      context: trigger.context,
      at: new Date(trigger.timestamp),
    });
  }, [alert]);

  if (!ready) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={GP.primary} />
      </View>
    );
  }

  if (!alert) {
    return (
      <View style={[styles.container, styles.center, { padding: 24 }]}>
        <Ionicons name="help-circle-outline" size={40} color={GP.textMuted} />
        <Text style={styles.missingTitle}>Incident not found</Text>
        <Text style={styles.missingText}>
          This alert is derived from the event log. If the underlying events were cleared, the
          incident no longer exists.
        </Text>
        <TouchableOpacity style={styles.backCta} onPress={() => router.back()}>
          <Text style={styles.backCtaText}>Back to console</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const accent = SEVERITY_COLOR[alert.severity];
  const timeline = [...alert.evidence].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const spanMinutes =
    timeline.length > 1
      ? Math.max(
          1,
          Math.round(
            (new Date(timeline[timeline.length - 1].timestamp).getTime() -
              new Date(timeline[0].timestamp).getTime()) /
              60000,
          ),
        )
      : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 48, ...socContentStyle }}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={GP.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>INCIDENT REPORT</Text>
          <Text style={styles.title}>{alert.ruleName}</Text>
        </View>
      </View>

      {/* ── Summary strip ── */}
      <Card style={{ ...styles.summaryCard, borderColor: `${accent}55` }}>
        <View style={styles.summaryTop}>
          <SeverityBadge severity={alert.severity} />
          <View style={styles.statusChip}>
            <Text style={styles.statusText}>
              {STATUS_LABEL[alert.status].toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ── Triage ──
            Transitions are constrained by the workflow rather than offered as a
            free choice, so an alert gets acknowledged before it can be closed. */}
        <View style={styles.triageRow}>
          <Text style={styles.triageLabel}>Move to</Text>
          <View style={styles.triageActions}>
            {allowedTransitions(alert.status).map((next) => (
              <TouchableOpacity
                key={next}
                style={styles.triageBtn}
                onPress={() => handleStatusChange(next)}>
                <Text style={styles.triageBtnText}>{STATUS_LABEL[next]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {triageFor(alert.id) ? (
          <Text style={styles.triageMeta}>
            Last updated {new Date(triageFor(alert.id)!.updatedAt).toLocaleString()}
          </Text>
        ) : null}
        <View style={styles.summaryGrid}>
          <SummaryItem label="Account" value={alert.actor ?? alert.userId} />
          <SummaryItem label="Detected" value={new Date(alert.detectedAt).toLocaleString()} />
          <SummaryItem label="Evidence" value={`${alert.evidence.length} events`} />
          {spanMinutes > 0 ? (
            <SummaryItem label="Attack window" value={`${spanMinutes} min`} />
          ) : null}
        </View>
      </Card>

      {/* ── Narrative ── */}
      <SectionTitle
        title="What happened"
        subtitle="Generated from the correlated evidence."
      />
      <Card>
        <Text style={styles.narrative}>{alert.explanation}</Text>
      </Card>

      {/* ── Risk breakdown ── */}
      {risk ? (
        <>
          <SectionTitle
            title="Risk assessment"
            subtitle="Every factor below is an independent detector with a bounded contribution. The score is their sum — no hidden weighting."
          />
          <Card>
            <RiskMeter score={risk.score} band={risk.band} />
            <View style={styles.decisionRow}>
              <Ionicons
                name={
                  risk.decision === 'block'
                    ? 'hand-left'
                    : risk.decision === 'challenge'
                      ? 'shield-half'
                      : risk.decision === 'monitor'
                        ? 'eye'
                        : 'checkmark-circle'
                }
                size={15}
                /* Colour by the risk band, not the alert severity — an "ALLOW"
                   rendered in critical red reads as a contradiction. */
                color={BAND_COLOR[risk.band]}
              />
              <Text style={[styles.decisionText, { color: BAND_COLOR[risk.band] }]}>
                Decision: {risk.decision.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.riskSummary}>{risk.summary}</Text>

            <View style={styles.divider} />

            {risk.factors.map((f) => (
              <FactorBar
                key={f.id}
                label={f.label}
                contribution={f.contribution}
                maxContribution={f.maxContribution}
                triggered={f.triggered}
                explanation={f.explanation}
              />
            ))}
          </Card>
        </>
      ) : null}

      {/* ── Attack timeline ── */}
      <SectionTitle
        title="Attack timeline"
        subtitle="The evidence in chronological order — the sequence is what distinguishes an attack from routine activity."
        right={
          timeline.length > 1 ? (
            <TouchableOpacity onPress={toggleReplay} style={styles.replayBtn}>
              <Ionicons
                name={replayStep === null ? 'play' : 'stop'}
                size={13}
                color={GP.textOnYellow}
              />
              <Text style={styles.replayBtnText}>
                {replayStep === null ? 'Replay' : 'Stop'}
              </Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      <Card>
        {timeline.map((event, i) => {
          const isLast = i === timeline.length - 1;
          // During replay, steps ahead of the playhead are hidden from view so
          // the sequence reveals itself the way it unfolded — the ordering is
          // the finding, and showing it all at once buries that.
          const isPending = replayStep !== null && i > replayStep;
          const isCurrent = replayStep === i;
          return (
            <View
              key={event.id}
              style={[
                styles.timelineRow,
                isPending && styles.timelineRowPending,
                isCurrent && styles.timelineRowCurrent,
              ]}>
              <View style={styles.timelineGutter}>
                <View
                  style={[styles.timelineDot, { backgroundColor: SEVERITY_COLOR[event.severity] }]}
                />
                {!isLast ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={[styles.timelineBody, isLast && { paddingBottom: 0 }]}>
                <View style={styles.timelineHead}>
                  <Text style={styles.timelineType}>{event.type}</Text>
                  <Text style={styles.timelineTime}>
                    {formatEventTime(event.timestamp)}
                  </Text>
                </View>
                {event.context.detail ? (
                  <Text style={styles.timelineDetail}>{event.context.detail}</Text>
                ) : null}
                <View style={styles.timelineMetaRow}>
                  {event.context.city ? (
                    <Meta icon="location-outline" text={`${event.context.city}, ${event.context.country ?? ''}`} />
                  ) : null}
                  {event.context.deviceName ? (
                    <Meta icon="phone-portrait-outline" text={event.context.deviceName} />
                  ) : null}
                  {event.context.ipAddress ? (
                    <Meta
                      icon={event.context.ipReputationFlagged ? 'warning-outline' : 'globe-outline'}
                      text={event.context.ipAddress}
                      danger={event.context.ipReputationFlagged}
                    />
                  ) : null}
                  {event.context.amountUsd != null ? (
                    <Meta icon="cash-outline" text={`$${event.context.amountUsd.toFixed(2)}`} />
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}
      </Card>

      {/* ── MITRE ── */}
      <SectionTitle
        title="MITRE ATT&CK mapping"
        subtitle="Techniques this detection corresponds to in the public adversary-behaviour knowledge base."
      />
      <View style={{ gap: 9 }}>
        {alert.mitre.map((m) => (
          <TouchableOpacity
            key={m.id}
            activeOpacity={0.8}
            onPress={() => Linking.openURL(m.url)}
            style={styles.mitreCard}>
            <View style={styles.mitreIdBox}>
              <Text style={styles.mitreId}>{m.id}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.mitreName}>{m.name}</Text>
              <Text style={styles.mitreTactic}>{m.tactic}</Text>
            </View>
            <Ionicons name="open-outline" size={15} color={GP.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Response ── */}
      <SectionTitle
        title="Recommended response"
        subtitle="Containment and remediation steps for this detection."
      />
      <Card>
        {alert.recommendations.map((rec, i) => (
          <View key={rec} style={[styles.recRow, i > 0 && styles.recRowSpaced]}>
            <View style={styles.recNum}>
              <Text style={styles.recNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.recText}>{rec}</Text>
          </View>
        ))}
      </Card>

      {/* ── Evidence integrity note ── */}
      <Card style={{ ...styles.integrityNote, marginTop: 22 }}>
        <Ionicons name="finger-print" size={17} color="#6B84C0" />
        <Text style={styles.integrityNoteText}>
          Every event above is hash-chained to the one before it. The chain head is committed to
          Polygon as a Merkle root, so this evidence trail can be proven unmodified to a third party
          without disclosing its contents.
        </Text>
      </Card>
    </ScrollView>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Meta({
  icon,
  text,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  danger?: boolean;
}) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={11} color={danger ? '#EF4444' : GP.textMuted} />
      <Text style={[styles.metaText, danger && { color: '#EF4444' }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GP.background },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: GP.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: GP.border,
  },
  eyebrow: { fontSize: 9.5, fontWeight: '800', color: GP.textMuted, letterSpacing: 1 },
  title: { fontSize: 20, fontWeight: '800', color: GP.textPrimary, letterSpacing: -0.4 },

  missingTitle: { fontSize: 16, fontWeight: '700', color: GP.textPrimary, marginTop: 12 },
  missingText: {
    fontSize: 12.5,
    color: GP.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
  },
  backCta: {
    marginTop: 18,
    backgroundColor: GP.primary,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 11,
  },
  backCtaText: { fontWeight: '700', color: GP.textOnYellow, fontSize: 13 },

  summaryCard: { gap: 12 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusChip: {
    backgroundColor: GP.background,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: GP.border,
  },
  statusText: { fontSize: 9.5, fontWeight: '800', color: GP.textSecondary, letterSpacing: 0.5 },
  triageRow: { gap: 7 },
  triageLabel: { fontSize: 9.5, fontWeight: '700', color: GP.textMuted, letterSpacing: 0.4 },
  triageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  triageBtn: {
    backgroundColor: GP.background,
    borderWidth: 1,
    borderColor: GP.borderLight,
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  triageBtnText: { fontSize: 11.5, fontWeight: '700', color: GP.textPrimary },
  triageMeta: { fontSize: 10, color: GP.textMuted },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  summaryItem: { minWidth: 120 },
  summaryLabel: { fontSize: 9.5, color: GP.textMuted, fontWeight: '700', letterSpacing: 0.4 },
  summaryValue: { fontSize: 12.5, color: GP.textPrimary, fontWeight: '600', marginTop: 2 },

  narrative: { fontSize: 13, color: GP.textSecondary, lineHeight: 20 },

  decisionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  decisionText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  riskSummary: { fontSize: 12, color: GP.textSecondary, lineHeight: 18, marginTop: 8 },
  divider: { height: 1, backgroundColor: GP.border, marginVertical: 16 },

  timelineRow: { flexDirection: 'row', gap: 11 },
  timelineRowPending: { opacity: 0.15 },
  timelineRowCurrent: {
    backgroundColor: `${GP.primary}12`,
    borderRadius: 8,
    marginHorizontal: -6,
    paddingHorizontal: 6,
  },
  replayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: GP.primary,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
  },
  replayBtnText: { fontSize: 11.5, fontWeight: '800', color: GP.textOnYellow },
  timelineGutter: { alignItems: 'center', width: 10 },
  timelineDot: { width: 9, height: 9, borderRadius: 5, marginTop: 3 },
  timelineLine: { flex: 1, width: 1.5, backgroundColor: GP.border, marginTop: 3 },
  timelineBody: { flex: 1, paddingBottom: 18 },
  timelineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  timelineType: {
    fontSize: 12,
    fontWeight: '800',
    color: GP.textPrimary,
    fontFamily: 'monospace',
    flex: 1,
  },
  timelineTime: { fontSize: 10, color: GP.textMuted },
  timelineDetail: { fontSize: 11.5, color: GP.textSecondary, lineHeight: 16.5, marginTop: 3 },
  timelineMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: GP.background,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderWidth: 1,
    borderColor: GP.border,
  },
  metaText: { fontSize: 9.5, color: GP.textMuted, fontWeight: '600' },

  mitreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: GP.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GP.border,
    padding: 12,
  },
  mitreIdBox: {
    backgroundColor: '#6B84C022',
    borderColor: '#6B84C055',
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  mitreId: { fontSize: 11, fontWeight: '800', color: '#8FA6DC', fontFamily: 'monospace' },
  mitreName: { fontSize: 13, fontWeight: '700', color: GP.textPrimary },
  mitreTactic: { fontSize: 10.5, color: GP.textMuted, marginTop: 1 },

  recRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  recRowSpaced: { marginTop: 12 },
  recNum: {
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: `${GP.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recNumText: { fontSize: 10, fontWeight: '800', color: GP.primary },
  recText: { flex: 1, fontSize: 12.5, color: GP.textSecondary, lineHeight: 18 },

  integrityNote: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#6B84C010',
    borderColor: '#6B84C033',
  },
  integrityNoteText: { flex: 1, fontSize: 11, color: GP.textSecondary, lineHeight: 16.5 },
});
