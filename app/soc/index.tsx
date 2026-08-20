/**
 * Security Operations Center — main console.
 *
 * The analyst-facing view of GlobalPay Secure: live metrics, the alert feed,
 * audit-chain integrity, and the attack-simulation controls used to demonstrate
 * detections without mounting a real attack.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { GP } from '@/constants/colors';
import {
  Card,
  MetricTile,
  SectionTitle,
  SeverityBadge,
  SEVERITY_COLOR,
  socContentStyle,
  formatEventTime,
} from '@/components/soc/primitives';
import {
  SCENARIOS,
  anchorNow,
  checkIntegrity,
  computeMetrics,
  getAlertsSync,
  getEventsSync,
  loadEvents,
  loadTriage,
  resetSecurityData,
  simulate,
  subscribeToEvents,
  subscribeToTriage,
  STATUS_LABEL,
  isActive,
  type ScenarioId,
} from '@/services/security/soc-service';
import { useAuth } from '@/context/auth-context';
import type { IntegrityReport, SecurityAlert, SecurityEvent } from '@/types/security';

export default function SocDashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);

  // The SOC operates on whichever account is signed in. Without a session we
  // still render — populated by the simulator — so the console can be reviewed
  // and demonstrated independently of the payment app's auth state.
  const target = useMemo(
    () => ({
      userId: user?.id ?? 'demo-user',
      actor: user?.globalPayId ?? 'demo@globalpay',
    }),
    [user?.id, user?.globalPayId],
  );

  const refreshIntegrity = useCallback(async () => {
    setIntegrity(await checkIntegrity());
  }, []);

  // Alerts are held in state and refreshed explicitly rather than derived in a
  // useMemo keyed on a counter: with the React Compiler enabled, a dependency
  // that the memo body never reads is optimised away, so triage updates would
  // persist without ever re-rendering.
  const refreshAlerts = useCallback(() => setAlerts(getAlertsSync()), []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [loaded] = await Promise.all([loadEvents(), loadTriage()]);
      if (!mounted) return;
      setEvents([...loaded]);
      refreshAlerts();
      await refreshIntegrity();
      if (mounted) setLoading(false);
    })();

    const unsubscribeEvents = subscribeToEvents((next) => {
      if (!mounted) return;
      setEvents([...next]);
      refreshAlerts();
    });
    // Triage changes do not touch the event log, so they need their own
    // subscription to refresh the alert list and the open-alert count.
    const unsubscribeTriage = subscribeToTriage(() => {
      if (mounted) refreshAlerts();
    });

    return () => {
      mounted = false;
      unsubscribeEvents();
      unsubscribeTriage();
    };
  }, [refreshIntegrity, refreshAlerts]);

  const metrics = useMemo(
    () => computeMetrics(events, alerts, integrity),
    [events, alerts, integrity],
  );

  const recentEvents = useMemo(
    () =>
      [...events]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 25),
    [events],
  );

  // ─── Actions ───
  const handleSimulate = async (scenario: ScenarioId) => {
    setBusy(scenario);
    try {
      await simulate(scenario, target);
      await refreshIntegrity();
    } finally {
      setBusy(null);
    }
  };

  const handleAnchor = async () => {
    setBusy('anchor');
    try {
      await anchorNow('local');
      await refreshIntegrity();
    } finally {
      setBusy(null);
    }
  };

  const handleReset = async () => {
    setBusy('reset');
    try {
      await resetSecurityData();
      await refreshIntegrity();
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={GP.primary} />
        <Text style={styles.loadingText}>Loading security telemetry…</Text>
      </View>
    );
  }

  const integrityTone =
    integrity?.status === 'verified'
      ? { color: '#4CAF50', icon: 'shield-checkmark' as const, label: 'INTEGRITY VERIFIED' }
      : integrity?.status === 'tampered'
        ? { color: '#EF4444', icon: 'warning' as const, label: 'TAMPERING DETECTED' }
        : { color: '#F2C94C', icon: 'shield-outline' as const, label: 'NOT YET ANCHORED' };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 48, ...socContentStyle }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refreshIntegrity} tintColor={GP.primary} />
      }>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={GP.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Security Operations Center</Text>
          <Text style={styles.subtitle}>
            Live monitoring · {target.actor}
          </Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* ── Integrity banner ── */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push('/soc/integrity' as any)}
        style={[
          styles.integrityBanner,
          { borderColor: `${integrityTone.color}55`, backgroundColor: `${integrityTone.color}12` },
        ]}>
        <Ionicons name={integrityTone.icon} size={20} color={integrityTone.color} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.integrityLabel, { color: integrityTone.color }]}>
            {integrityTone.label}
          </Text>
          <Text style={styles.integrityMessage} numberOfLines={2}>
            {integrity?.message ?? 'Audit chain has not been evaluated yet.'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={GP.textMuted} />
      </TouchableOpacity>

      {/* ── Coverage link ── */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push('/soc/mitre' as any)}
        style={styles.coverageLink}>
        <Ionicons name="grid-outline" size={18} color="#8FA6DC" />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.coverageTitle}>MITRE ATT&CK coverage</Text>
          <Text style={styles.coverageSub}>
            Which adversary techniques are covered, and which have actually fired
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={GP.textMuted} />
      </TouchableOpacity>

      {/* ── Metrics ── */}
      <View style={styles.tileGrid}>
        <MetricTile
          label="Total events"
          value={metrics.totalEvents}
          icon="pulse"
          accent="#6B84C0"
          hint={`${metrics.eventsLast24h} in last 24h`}
        />
        <MetricTile
          label="Open alerts"
          value={metrics.openAlerts}
          icon="notifications"
          accent={metrics.openAlerts > 0 ? '#F5871F' : '#4CAF50'}
          hint={`${metrics.criticalAlerts} critical`}
        />
      </View>
      <View style={styles.tileGrid}>
        <MetricTile
          label="High-risk events"
          value={metrics.highRiskEvents}
          icon="flame"
          accent="#EF4444"
          hint="severity high or above"
        />
        <MetricTile
          label="Mean risk"
          value={metrics.meanRiskScore}
          icon="speedometer"
          accent={metrics.meanRiskScore >= 50 ? '#F5871F' : '#4CAF50'}
          hint="across all events"
        />
      </View>

      {/* ── Attack simulator ── */}
      <SectionTitle
        title="Attack Simulation"
        subtitle="Generate synthetic event sequences to exercise the detection rules. Writes to the local event log only — no network traffic is produced."
        right={
          <TouchableOpacity
            onPress={() => setShowSimulator((s) => !s)}
            style={styles.toggleBtn}>
            <Ionicons
              name={showSimulator ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={GP.textOnYellow}
            />
          </TouchableOpacity>
        }
      />

      {showSimulator ? (
        <View style={{ gap: 10 }}>
          {SCENARIOS.map((s) => (
            <TouchableOpacity
              key={s.id}
              activeOpacity={0.8}
              disabled={busy !== null}
              onPress={() => handleSimulate(s.id)}
              style={styles.scenarioCard}>
              <View style={styles.scenarioIcon}>
                {busy === s.id ? (
                  <ActivityIndicator size="small" color={GP.primary} />
                ) : (
                  <Ionicons name={s.icon as any} size={18} color={GP.primary} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scenarioName}>{s.name}</Text>
                <Text style={styles.scenarioDesc}>{s.description}</Text>
                <View style={styles.expectedRow}>
                  {s.expectedDetections.map((d) => (
                    <View key={d} style={styles.expectedChip}>
                      <Text style={styles.expectedText}>{d}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Ionicons name="play-circle" size={20} color={GP.textMuted} />
            </TouchableOpacity>
          ))}

          <View style={styles.utilityRow}>
            <TouchableOpacity
              style={[styles.utilityBtn, { borderColor: '#4CAF5066' }]}
              disabled={busy !== null}
              onPress={handleAnchor}>
              {busy === 'anchor' ? (
                <ActivityIndicator size="small" color="#4CAF50" />
              ) : (
                <Ionicons name="link" size={16} color="#4CAF50" />
              )}
              <Text style={[styles.utilityText, { color: '#4CAF50' }]}>Anchor audit log</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.utilityBtn, { borderColor: '#EF444466' }]}
              disabled={busy !== null}
              onPress={handleReset}>
              {busy === 'reset' ? (
                <ActivityIndicator size="small" color="#EF4444" />
              ) : (
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
              )}
              <Text style={[styles.utilityText, { color: '#EF4444' }]}>Reset data</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* ── Alerts ── */}
      <SectionTitle
        title={`Active Alerts (${alerts.length})`}
        subtitle="Correlated detections, newest first. Tap an alert for the full incident report."
      />

      {alerts.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="shield-checkmark-outline" size={26} color={GP.textMuted} />
          <Text style={styles.emptyTitle}>No active alerts</Text>
          <Text style={styles.emptyText}>
            Nothing has correlated to a detection rule. Run an attack simulation above to see the
            detection pipeline fire.
          </Text>
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {alerts.map((alert) => (
            <TouchableOpacity
              key={alert.id}
              activeOpacity={0.8}
              onPress={() => router.push(`/soc/${encodeURIComponent(alert.id)}` as any)}
              style={[
                styles.alertCard,
                { borderLeftColor: SEVERITY_COLOR[alert.severity], borderLeftWidth: 3 },
                // Closed alerts recede rather than disappear — an analyst still
                // needs to see what was dismissed and why.
                !isActive(alert.status) && styles.alertCardClosed,
              ]}>
              <View style={styles.alertHeader}>
                <Text style={styles.alertName}>{alert.ruleName}</Text>
                {/* A triaged alert shows where it got to; untriaged ones stay
                    clean so severity remains the thing the eye lands on. */}
                {alert.status !== 'open' ? (
                  <View style={styles.alertStatusChip}>
                    <Text style={styles.alertStatusText}>
                      {STATUS_LABEL[alert.status].toUpperCase()}
                    </Text>
                  </View>
                ) : null}
                <SeverityBadge severity={alert.severity} />
              </View>
              <Text style={styles.alertExplanation} numberOfLines={3}>
                {alert.explanation}
              </Text>
              <View style={styles.alertFooter}>
                <View style={styles.mitreRow}>
                  {alert.mitre.slice(0, 2).map((m) => (
                    <View key={m.id} style={styles.mitreChip}>
                      <Text style={styles.mitreText}>{m.id}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.alertMeta}>
                  {alert.evidence.length} event{alert.evidence.length === 1 ? '' : 's'} ·{' '}
                  {new Date(alert.detectedAt).toLocaleTimeString()}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Event stream ── */}
      <SectionTitle
        title="Event Stream"
        subtitle={`Most recent ${recentEvents.length} of ${events.length} hash-chained events.`}
      />

      {recentEvents.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            The event log is empty. Security events are appended as you use the app, or can be
            generated with the simulator.
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          {recentEvents.map((event, i) => (
            <View
              key={event.id}
              style={[styles.eventRow, i < recentEvents.length - 1 && styles.eventRowBorder]}>
              <View
                style={[
                  styles.eventDot,
                  { backgroundColor: SEVERITY_COLOR[event.severity] },
                ]}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.eventTopRow}>
                  <Text style={styles.eventType}>{event.type}</Text>
                  {event.context.simulated ? (
                    <View style={styles.simChip}>
                      <Text style={styles.simText}>SIM</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.eventDetail} numberOfLines={2}>
                  {event.context.detail ??
                    [event.context.city, event.context.deviceName].filter(Boolean).join(' · ') ??
                    '—'}
                </Text>
                <Text style={styles.eventHash}>
                  {formatEventTime(event.timestamp)} · {event.hash.slice(0, 18)}…
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GP.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: GP.textSecondary, marginTop: 12, fontSize: 13 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 10 },
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
  title: { fontSize: 19, fontWeight: '800', color: GP.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: GP.textMuted, marginTop: 1 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4CAF5022',
    borderColor: '#4CAF5055',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 5,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' },
  liveText: { fontSize: 9, fontWeight: '800', color: '#4CAF50', letterSpacing: 0.5 },

  integrityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
    borderRadius: 13,
    borderWidth: 1,
    marginBottom: 16,
  },
  integrityLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  integrityMessage: { fontSize: 11, color: GP.textSecondary, marginTop: 3, lineHeight: 15 },

  tileGrid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  coverageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6B84C010',
    borderColor: '#6B84C033',
    borderWidth: 1,
    borderRadius: 13,
    padding: 13,
    marginBottom: 16,
  },
  coverageTitle: { fontSize: 13, fontWeight: '700', color: GP.textPrimary },
  coverageSub: { fontSize: 10.5, color: GP.textMuted, marginTop: 2 },

  toggleBtn: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: GP.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scenarioCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: GP.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GP.border,
    padding: 13,
    gap: 11,
  },
  scenarioIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: `${GP.primary}1A`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scenarioName: { fontSize: 14, fontWeight: '700', color: GP.textPrimary },
  scenarioDesc: { fontSize: 11.5, color: GP.textSecondary, lineHeight: 16, marginTop: 3 },
  expectedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  expectedChip: {
    backgroundColor: GP.background,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: GP.border,
  },
  expectedText: { fontSize: 9.5, color: GP.textMuted, fontWeight: '600' },

  utilityRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  utilityBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 11,
    borderWidth: 1,
    backgroundColor: GP.card,
  },
  utilityText: { fontSize: 12, fontWeight: '700' },

  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: GP.textPrimary },
  emptyText: {
    fontSize: 12,
    color: GP.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },

  alertCard: {
    backgroundColor: GP.card,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: GP.border,
    padding: 13,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
    gap: 8,
  },
  alertName: { fontSize: 14, fontWeight: '800', color: GP.textPrimary, flex: 1 },
  alertCardClosed: { opacity: 0.55 },
  alertStatusChip: {
    backgroundColor: GP.background,
    borderWidth: 1,
    borderColor: GP.borderLight,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  alertStatusText: { fontSize: 9, fontWeight: '800', color: GP.textSecondary, letterSpacing: 0.4 },
  alertExplanation: { fontSize: 11.5, color: GP.textSecondary, lineHeight: 16.5 },
  alertFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 8,
  },
  mitreRow: { flexDirection: 'row', gap: 5 },
  mitreChip: {
    backgroundColor: '#6B84C022',
    borderColor: '#6B84C055',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  mitreText: { fontSize: 9.5, fontWeight: '700', color: '#8FA6DC' },
  alertMeta: { fontSize: 10, color: GP.textMuted },

  eventRow: { flexDirection: 'row', padding: 12, gap: 10, alignItems: 'flex-start' },
  eventRowBorder: { borderBottomWidth: 1, borderBottomColor: GP.border },
  eventDot: { width: 7, height: 7, borderRadius: 4, marginTop: 5 },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventType: {
    fontSize: 12,
    fontWeight: '700',
    color: GP.textPrimary,
    fontFamily: 'monospace',
  },
  simChip: {
    backgroundColor: `${GP.primary}22`,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  simText: { fontSize: 8, fontWeight: '800', color: GP.primary },
  eventDetail: { fontSize: 11, color: GP.textSecondary, marginTop: 2, lineHeight: 15 },
  eventHash: { fontSize: 9.5, color: GP.textMuted, marginTop: 3, fontFamily: 'monospace' },
});
