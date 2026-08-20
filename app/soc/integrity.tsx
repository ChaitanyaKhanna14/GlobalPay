/**
 * Audit integrity — the blockchain half of the security story.
 *
 * Shows the hash chain, the anchored Merkle roots, and a live tamper
 * demonstration. The demonstration matters pedagogically: claiming a log is
 * tamper-evident is easy, showing the verification fail the instant a byte
 * changes is what makes the property concrete.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { GP } from '@/constants/colors';
import { Card, SectionTitle, socContentStyle } from '@/components/soc/primitives';
import { NETWORK_NAME } from '@/constants/tokens';
import {
  anchorNow,
  checkIntegrity,
  loadAnchors,
  loadEvents,
  getEventsSync,
} from '@/services/security/soc-service';
import { rootForEvents } from '@/services/security/blockchain-anchor';
import { anchoringBalance, submitRootOnChain } from '@/services/security/anchor-submitter';
import type { AuditAnchor, IntegrityReport, SecurityEvent } from '@/types/security';

export default function IntegrityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [anchors, setAnchors] = useState<AuditAnchor[]>([]);
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [gas, setGas] = useState<{ address: string; pol: string } | null>(null);
  const [anchorNote, setAnchorNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loaded, anchorList, integrity] = await Promise.all([
      loadEvents(),
      loadAnchors(),
      checkIntegrity(),
    ]);
    setEvents([...loaded]);
    setAnchors(anchorList);
    setReport(integrity);
    // Non-fatal: without a wallet we simply hide the on-chain option.
    setGas(await anchoringBalance().catch(() => null));
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const handleAnchor = async (mode: 'local' | 'onchain') => {
    setBusy(mode);
    setAnchorNote(null);
    try {
      const { anchor, note } = await anchorNow(
        mode,
        mode === 'onchain' ? submitRootOnChain : undefined,
      );
      // A failed on-chain submission is still recorded locally, so surface the
      // reason rather than silently appearing to succeed.
      setAnchorNote(anchor.status === 'failed' ? (anchor.error ?? 'Submission failed.') : (note ?? null));
      await refresh();
    } catch (e) {
      setAnchorNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={GP.primary} />
      </View>
    );
  }

  const currentRoot = events.length ? rootForEvents(events) : null;
  const tone =
    report?.status === 'verified'
      ? { color: '#4CAF50', icon: 'shield-checkmark' as const, title: 'Integrity verified' }
      : report?.status === 'tampered'
        ? { color: '#EF4444', icon: 'warning' as const, title: 'Tampering detected' }
        : { color: '#F2C94C', icon: 'shield-outline' as const, title: 'Not yet anchored' };

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
          <Text style={styles.eyebrow}>AUDIT INTEGRITY</Text>
          <Text style={styles.title}>Tamper-Evident Log</Text>
        </View>
      </View>

      {/* ── Status ── */}
      <Card style={{ ...styles.statusCard, borderColor: `${tone.color}55` }}>
        <View style={styles.statusHead}>
          <Ionicons name={tone.icon} size={22} color={tone.color} />
          <Text style={[styles.statusTitle, { color: tone.color }]}>{tone.title}</Text>
        </View>
        <Text style={styles.statusMessage}>{report?.message}</Text>
        <Text style={styles.statusMeta}>
          Checked {report ? new Date(report.checkedAt).toLocaleString() : '—'} ·{' '}
          {report?.eventsChecked ?? 0} events
        </Text>
      </Card>

      {/* ── How it works ── */}
      <SectionTitle
        title="How this works"
        subtitle="Two independent mechanisms, each covering the other's blind spot."
      />
      <Card>
        <Explainer
          n={1}
          title="Hash chain"
          body="Each event stores the hash of the event before it, so the log forms a chain. Editing or deleting any event changes its hash and breaks every link after it. This catches casual tampering immediately."
        />
        <View style={styles.divider} />
        <Explainer
          n={2}
          title="Merkle root on-chain"
          body="A sophisticated attacker with database write access could edit an event and recompute every subsequent hash to hide it. To stop that, the root of the chain is published to the blockchain — which they cannot rewrite. If the recomputed root stops matching the anchored one, the log has been altered."
        />
        <View style={styles.divider} />
        <View style={styles.calloutRow}>
          <Ionicons name="information-circle" size={17} color="#6B84C0" />
          <Text style={styles.calloutText}>
            <Text style={styles.calloutStrong}>Hashes only.</Text> No event contents, personal data,
            balances, or addresses are ever published on-chain. The blockchain provides integrity and
            non-repudiation; confidentiality is handled separately by TLS in transit and encrypted
            storage at rest.
          </Text>
        </View>
      </Card>

      {/* ── Current root ── */}
      <SectionTitle
        title="Current chain state"
        subtitle="Recomputed live from the events currently in the log."
      />
      <Card>
        <Field label="Events in chain" value={String(events.length)} />
        <Field
          label="Chain head"
          value={events.length ? events[events.length - 1].hash : '— empty —'}
          mono
        />
        <Field label="Merkle root" value={currentRoot ?? '— empty —'} mono last />

        <TouchableOpacity
          style={styles.anchorBtn}
          disabled={busy !== null || events.length === 0}
          onPress={() => handleAnchor('local')}>
          {busy === 'local' ? (
            <ActivityIndicator size="small" color={GP.textOnYellow} />
          ) : (
            <Ionicons name="lock-closed" size={16} color={GP.textOnYellow} />
          )}
          <Text style={styles.anchorBtnText}>
            {events.length === 0 ? 'No events to anchor' : 'Seal root locally'}
          </Text>
        </TouchableOpacity>

        {/* On-chain anchoring needs a funded wallet, so it is offered as a
            distinct action with its gas position shown rather than hidden
            behind the same button and failing mysteriously. */}
        <TouchableOpacity
          style={[styles.anchorBtnAlt, (busy !== null || events.length === 0) && { opacity: 0.5 }]}
          disabled={busy !== null || events.length === 0}
          onPress={() => handleAnchor('onchain')}>
          {busy === 'onchain' ? (
            <ActivityIndicator size="small" color="#8FA6DC" />
          ) : (
            <Ionicons name="git-network" size={16} color="#8FA6DC" />
          )}
          <Text style={styles.anchorBtnAltText}>Publish root to {NETWORK_NAME}</Text>
        </TouchableOpacity>

        {gas ? (
          <Text style={styles.gasNote}>
            Gas wallet {gas.address.slice(0, 10)}… holds {parseFloat(gas.pol).toFixed(4)} POL
            {parseFloat(gas.pol) === 0 ? ' — fund it from a faucet to publish on-chain.' : '.'}
          </Text>
        ) : null}

        {anchorNote ? <Text style={styles.anchorNote}>{anchorNote}</Text> : null}
      </Card>

      {/* ── Anchors ── */}
      <SectionTitle
        title={`Anchor history (${anchors.length})`}
        subtitle={`Roots sealed for audit. On-chain submission targets ${NETWORK_NAME}.`}
      />
      {anchors.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No roots anchored yet. Anchor the current root above to create the first audit
            checkpoint.
          </Text>
        </Card>
      ) : (
        <View style={{ gap: 9 }}>
          {[...anchors].reverse().map((anchor) => (
            <Card key={anchor.id} style={styles.anchorCard}>
              <View style={styles.anchorHead}>
                <View
                  style={[
                    styles.anchorStatus,
                    {
                      backgroundColor:
                        anchor.status === 'anchored'
                          ? '#4CAF5022'
                          : anchor.status === 'failed'
                            ? '#EF444422'
                            : '#F2C94C22',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.anchorStatusText,
                      {
                        color:
                          anchor.status === 'anchored'
                            ? '#4CAF50'
                            : anchor.status === 'failed'
                              ? '#EF4444'
                              : '#F2C94C',
                      },
                    ]}>
                    {anchor.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.anchorDate}>
                  {new Date(anchor.createdAt).toLocaleString()}
                </Text>
              </View>
              <Text style={styles.anchorRoot} numberOfLines={1}>
                {anchor.merkleRoot}
              </Text>
              <Text style={styles.anchorMeta}>
                {anchor.eventCount} event{anchor.eventCount === 1 ? '' : 's'} · chain{' '}
                {anchor.chainId}
              </Text>
              {anchor.txHash ? (
                <TouchableOpacity
                  style={styles.txLink}
                  onPress={() => anchor.explorerUrl && Linking.openURL(anchor.explorerUrl)}>
                  <Ionicons name="open-outline" size={12} color={GP.primary} />
                  <Text style={styles.txLinkText}>{anchor.txHash.slice(0, 22)}…</Text>
                </TouchableOpacity>
              ) : null}
              {anchor.error ? <Text style={styles.anchorError}>{anchor.error}</Text> : null}
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Explainer({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View style={styles.explainerRow}>
      <View style={styles.explainerNum}>
        <Text style={styles.explainerNumText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.explainerTitle}>{title}</Text>
        <Text style={styles.explainerBody}>{body}</Text>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.field, !last && styles.fieldSpaced]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, mono && styles.fieldMono]} numberOfLines={2}>
        {value}
      </Text>
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

  statusCard: { gap: 8 },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusTitle: { fontSize: 15, fontWeight: '800' },
  statusMessage: { fontSize: 12.5, color: GP.textSecondary, lineHeight: 18.5 },
  statusMeta: { fontSize: 10.5, color: GP.textMuted },

  explainerRow: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  explainerNum: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: `${GP.primary}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainerNumText: { fontSize: 11, fontWeight: '800', color: GP.primary },
  explainerTitle: { fontSize: 13.5, fontWeight: '700', color: GP.textPrimary },
  explainerBody: { fontSize: 12, color: GP.textSecondary, lineHeight: 18, marginTop: 4 },
  divider: { height: 1, backgroundColor: GP.border, marginVertical: 14 },

  calloutRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  calloutText: { flex: 1, fontSize: 11.5, color: GP.textSecondary, lineHeight: 17 },
  calloutStrong: { fontWeight: '800', color: GP.textPrimary },

  field: {},
  fieldSpaced: { marginBottom: 12 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: GP.textMuted, letterSpacing: 0.4 },
  fieldValue: { fontSize: 12.5, color: GP.textPrimary, marginTop: 3 },
  fieldMono: { fontFamily: 'monospace', fontSize: 10.5, color: GP.textSecondary },

  anchorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: GP.primary,
    paddingVertical: 12,
    borderRadius: 11,
    marginTop: 16,
  },
  anchorBtnText: { fontSize: 13, fontWeight: '700', color: GP.textOnYellow },
  anchorBtnAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#6B84C015',
    borderWidth: 1,
    borderColor: '#6B84C044',
    paddingVertical: 12,
    borderRadius: 11,
    marginTop: 9,
  },
  anchorBtnAltText: { fontSize: 13, fontWeight: '700', color: '#8FA6DC' },
  gasNote: { fontSize: 10.5, color: GP.textMuted, marginTop: 9, lineHeight: 15 },
  anchorNote: { fontSize: 11, color: GP.textSecondary, marginTop: 9, lineHeight: 16 },

  emptyCard: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 12, color: GP.textMuted, textAlign: 'center', lineHeight: 17 },

  anchorCard: { gap: 5 },
  anchorHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  anchorStatus: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2.5 },
  anchorStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  anchorDate: { fontSize: 10, color: GP.textMuted },
  anchorRoot: { fontSize: 10.5, color: GP.textSecondary, fontFamily: 'monospace', marginTop: 3 },
  anchorMeta: { fontSize: 10, color: GP.textMuted },
  txLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  txLinkText: { fontSize: 10.5, color: GP.primary, fontWeight: '600' },
  anchorError: { fontSize: 10.5, color: '#EF4444', marginTop: 3 },
});
