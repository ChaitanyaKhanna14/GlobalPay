/**
 * MITRE ATT&CK coverage matrix.
 *
 * Maps every detection rule onto the public adversary-behaviour taxonomy, and —
 * more usefully — separates techniques that have actually *fired* in this
 * environment from those merely covered on paper.
 *
 * That distinction is the whole value. A coverage claim of "we detect T1110" is
 * cheap; a matrix that shows which rules have ever proven themselves, and where
 * the gaps are, is something a security team can act on.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { GP } from '@/constants/colors';
import { Card, SectionTitle, socContentStyle } from '@/components/soc/primitives';
import {
  ALL_TECHNIQUES,
  RULES,
  getAlertsSync,
  loadEvents,
  loadTriage,
  techniquesByTactic,
} from '@/services/security/soc-service';
import type { DetectionRule, MitreTechnique } from '@/types/security';

/** ATT&CK orders tactics by where they sit in an intrusion, not alphabetically. */
const TACTIC_ORDER = [
  'Initial Access',
  'Credential Access',
  'Persistence',
  'Defense Evasion',
  'Lateral Movement',
  'Exfiltration',
  'Impact',
];

export default function MitreMatrix() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([loadEvents(), loadTriage()]).then(() => setReady(true));
  }, []);

  /** Technique id → the rules that map to it. */
  const rulesByTechnique = useMemo(() => {
    const map = new Map<string, DetectionRule[]>();
    for (const rule of Object.values(RULES)) {
      for (const technique of rule.mitre) {
        const bucket = map.get(technique.id);
        if (bucket) bucket.push(rule);
        else map.set(technique.id, [rule]);
      }
    }
    return map;
  }, []);

  /** Technique ids that have actually fired here. */
  const firedTechniques = useMemo(() => {
    const fired = new Set<string>();
    if (!ready) return fired;
    for (const alert of getAlertsSync()) {
      for (const technique of alert.mitre) fired.add(technique.id);
    }
    return fired;
  }, [ready]);

  const grouped = useMemo(() => techniquesByTactic(), []);
  const tactics = useMemo(
    () => Object.keys(grouped).sort((a, b) => TACTIC_ORDER.indexOf(a) - TACTIC_ORDER.indexOf(b)),
    [grouped],
  );

  const firedCount = ALL_TECHNIQUES.filter((t) => firedTechniques.has(t.id)).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        padding: 16,
        paddingTop: insets.top + 12,
        paddingBottom: 48,
        ...socContentStyle,
      }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={GP.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>THREAT COVERAGE</Text>
          <Text style={styles.title}>MITRE ATT&CK Matrix</Text>
        </View>
      </View>

      <Card style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: GP.primary }]}>
              {ALL_TECHNIQUES.length}
            </Text>
            <Text style={styles.summaryLabel}>Techniques mapped</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: '#EF4444' }]}>{firedCount}</Text>
            <Text style={styles.summaryLabel}>Observed here</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: '#6B84C0' }]}>
              {Object.keys(RULES).length}
            </Text>
            <Text style={styles.summaryLabel}>Detection rules</Text>
          </View>
        </View>

        <View style={styles.legend}>
          <LegendDot color="#EF4444" label="Observed — a detection has fired" />
          <LegendDot color="#6B84C0" label="Covered — rule exists, not yet seen" />
        </View>
      </Card>

      <SectionTitle
        title="Coverage by tactic"
        subtitle="Ordered by where each tactic sits in an intrusion, not alphabetically."
      />

      {tactics.map((tactic) => (
        <View key={tactic} style={styles.tacticBlock}>
          <View style={styles.tacticHeader}>
            <Text style={styles.tacticName}>{tactic}</Text>
            <Text style={styles.tacticCount}>
              {grouped[tactic].filter((t) => firedTechniques.has(t.id)).length}/
              {grouped[tactic].length}
            </Text>
          </View>

          <View style={styles.techGrid}>
            {grouped[tactic].map((technique: MitreTechnique) => {
              const isFired = firedTechniques.has(technique.id);
              const accent = isFired ? '#EF4444' : '#6B84C0';
              const rules = rulesByTechnique.get(technique.id) ?? [];

              return (
                <TouchableOpacity
                  key={technique.id}
                  activeOpacity={0.8}
                  onPress={() => Linking.openURL(technique.url)}
                  style={[
                    styles.techCard,
                    { borderColor: accent + '55', backgroundColor: accent + '10' },
                  ]}>
                  <View style={styles.techTop}>
                    <Text style={[styles.techId, { color: accent }]}>{technique.id}</Text>
                    {isFired ? (
                      <View style={[styles.firedDot, { backgroundColor: accent }]} />
                    ) : null}
                  </View>
                  <Text style={styles.techName}>{technique.name}</Text>
                  {rules.length ? (
                    <Text style={styles.techRules} numberOfLines={2}>
                      {rules.map((r) => r.name).join(' · ')}
                    </Text>
                  ) : (
                    <Text style={styles.techNoRule}>No rule mapped</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      <Card style={styles.noteCard}>
        <Ionicons name="information-circle" size={17} color="#6B84C0" />
        <Text style={styles.noteText}>
          This matrix covers the techniques GlobalPay Secure actually detects — it is not the full
          ATT&CK Enterprise matrix, which spans hundreds of techniques across fourteen tactics.
          Claiming coverage we do not have would be worse than claiming none.
        </Text>
      </Card>
    </ScrollView>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GP.background },
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

  summaryCard: { gap: 14 },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryItem: { flex: 1 },
  summaryValue: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  summaryLabel: { fontSize: 10.5, color: GP.textMuted, marginTop: 2 },
  legend: { gap: 6, borderTopWidth: 1, borderTopColor: GP.border, paddingTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, color: GP.textSecondary },

  tacticBlock: { marginBottom: 18 },
  tacticHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  tacticName: { fontSize: 13.5, fontWeight: '800', color: GP.textPrimary, letterSpacing: -0.2 },
  tacticCount: { fontSize: 11, fontWeight: '700', color: GP.textMuted },
  techGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  techCard: {
    flexGrow: 1,
    flexBasis: 200,
    minWidth: 180,
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
  },
  techTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  techId: { fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
  firedDot: { width: 7, height: 7, borderRadius: 4 },
  techName: { fontSize: 12.5, fontWeight: '700', color: GP.textPrimary, marginTop: 4 },
  techRules: { fontSize: 10, color: GP.textSecondary, marginTop: 4, lineHeight: 14 },
  techNoRule: { fontSize: 10, color: GP.textMuted, marginTop: 4, fontStyle: 'italic' },

  noteCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#6B84C010',
    borderColor: '#6B84C033',
    marginTop: 8,
  },
  noteText: { flex: 1, fontSize: 11, color: GP.textSecondary, lineHeight: 16.5 },
});
