/**
 * Shared SOC dashboard primitives.
 *
 * Kept separate from the screens so the visual language of the security
 * console — severity colour, metric tiles, risk meters — is defined once and
 * stays consistent across the dashboard and the incident detail view.
 */
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GP } from '@/constants/colors';
import type { RiskBand, Severity } from '@/types/security';

// ─── Severity palette ───────────────────────────
// Deliberately not the brand yellow: severity must read as severity, not as
// decoration, and analysts scan these by colour before they read the label.
export const SEVERITY_COLOR: Record<Severity, string> = {
  info: '#6B84C0',
  low: '#4CAF50',
  medium: '#F2C94C',
  high: '#F5871F',
  critical: '#EF4444',
};

export const BAND_COLOR: Record<RiskBand, string> = {
  low: '#4CAF50',
  medium: '#F2C94C',
  high: '#F5871F',
  critical: '#EF4444',
};

export function severityLabel(severity: Severity): string {
  return severity.toUpperCase();
}

/**
 * Timestamp for the event feed.
 *
 * Showing bare times makes a list spanning several days look out of order — a
 * baseline event from Tuesday at 11:05 appears "later" than an attack event
 * from today at 10:16. Older entries therefore carry their date.
 */
export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();

  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) return time;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return `Yesterday ${time}`;

  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

// ─── Severity pill ──────────────────────────────
export function SeverityBadge({ severity }: { severity: Severity }) {
  const color = SEVERITY_COLOR[severity];
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22`, borderColor: `${color}66` }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{severityLabel(severity)}</Text>
    </View>
  );
}

// ─── Metric tile ────────────────────────────────
export function MetricTile({
  label,
  value,
  icon,
  accent = GP.primary,
  hint,
}: {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  accent?: string;
  hint?: string;
}) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileHeader}>
        <View style={[styles.tileIcon, { backgroundColor: `${accent}22` }]}>
          <Ionicons name={icon} size={16} color={accent} />
        </View>
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
      <Text style={[styles.tileValue, { color: accent }]}>{value}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

// ─── Section heading ────────────────────────────
export function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ─── Risk meter ─────────────────────────────────
/** Horizontal 0–100 meter with the band's colour and threshold ticks. */
export function RiskMeter({ score, band }: { score: number; band: RiskBand }) {
  const color = BAND_COLOR[band];
  return (
    <View style={styles.meterWrap}>
      <View style={styles.meterHeader}>
        <Text style={styles.meterScore}>
          {score}
          <Text style={styles.meterScoreMax}>/100</Text>
        </Text>
        <View style={[styles.badge, { backgroundColor: `${color}22`, borderColor: `${color}66` }]}>
          <Text style={[styles.badgeText, { color }]}>{band.toUpperCase()} RISK</Text>
        </View>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.max(score, 2)}%`, backgroundColor: color }]} />
        {/* Band thresholds at 25 / 50 / 75 */}
        {[25, 50, 75].map((t) => (
          <View key={t} style={[styles.meterTick, { left: `${t}%` }]} />
        ))}
      </View>
      <View style={styles.meterScale}>
        <Text style={styles.meterScaleText}>0</Text>
        <Text style={styles.meterScaleText}>25</Text>
        <Text style={styles.meterScaleText}>50</Text>
        <Text style={styles.meterScaleText}>75</Text>
        <Text style={styles.meterScaleText}>100</Text>
      </View>
    </View>
  );
}

// ─── Factor bar ─────────────────────────────────
/** One explainable risk factor, rendered as a proportion of its own maximum. */
export function FactorBar({
  label,
  contribution,
  maxContribution,
  triggered,
  explanation,
}: {
  label: string;
  contribution: number;
  maxContribution: number;
  triggered: boolean;
  explanation: string;
}) {
  const pct = maxContribution > 0 ? (contribution / maxContribution) * 100 : 0;
  const color = triggered ? (pct > 60 ? '#EF4444' : '#F5871F') : GP.border;

  return (
    <View style={styles.factorRow}>
      <View style={styles.factorHeader}>
        <View style={styles.factorLabelWrap}>
          <Ionicons
            name={triggered ? 'alert-circle' : 'checkmark-circle-outline'}
            size={14}
            color={triggered ? color : GP.textMuted}
          />
          <Text style={[styles.factorLabel, !triggered && styles.factorLabelMuted]}>{label}</Text>
        </View>
        <Text style={[styles.factorPoints, { color: triggered ? color : GP.textMuted }]}>
          {triggered ? `+${contribution}` : '0'}
          <Text style={styles.factorPointsMax}> / {maxContribution}</Text>
        </Text>
      </View>
      <View style={styles.factorTrack}>
        <View style={[styles.factorFill, { width: `${Math.max(pct, 0)}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.factorExplanation}>{explanation}</Text>
    </View>
  );
}

/**
 * Content width cap for the SOC screens.
 *
 * These are phone layouts, so on a desktop browser they would otherwise stretch
 * edge to edge and read as a stretched mobile app rather than a console. On a
 * phone the viewport is narrower than the cap, so this is a no-op there.
 */
export const socContentStyle = {
  width: '100%' as const,
  maxWidth: 920,
  alignSelf: 'center' as const,
};

// ─── Card ───────────────────────────────────────
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeDot: { width: 5, height: 5, borderRadius: 3, marginRight: 5 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },

  tile: {
    flex: 1,
    minWidth: 140,
    backgroundColor: GP.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GP.border,
    padding: 14,
  },
  tileHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  tileIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  tileLabel: { fontSize: 11, color: GP.textSecondary, fontWeight: '600', flex: 1 },
  tileValue: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  tileHint: { fontSize: 10, color: GP.textMuted, marginTop: 3 },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 26,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: GP.textPrimary, letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 12, color: GP.textMuted, marginTop: 2, lineHeight: 17 },

  meterWrap: { marginVertical: 4 },
  meterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  meterScore: { fontSize: 34, fontWeight: '800', color: GP.textPrimary, letterSpacing: -1 },
  meterScoreMax: { fontSize: 15, fontWeight: '600', color: GP.textMuted },
  meterTrack: {
    height: 10,
    backgroundColor: GP.background,
    borderRadius: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: GP.border,
    position: 'relative',
  },
  meterFill: { height: '100%', borderRadius: 5 },
  meterTick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: GP.borderLight,
  },
  meterScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  meterScaleText: { fontSize: 9, color: GP.textMuted },

  factorRow: { marginBottom: 16 },
  factorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  factorLabelWrap: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 },
  factorLabel: { fontSize: 13, fontWeight: '700', color: GP.textPrimary },
  factorLabelMuted: { color: GP.textMuted, fontWeight: '600' },
  factorPoints: { fontSize: 12, fontWeight: '800' },
  factorPointsMax: { fontSize: 10, fontWeight: '600', color: GP.textMuted },
  factorTrack: {
    height: 5,
    backgroundColor: GP.background,
    borderRadius: 3,
    overflow: 'hidden',
  },
  factorFill: { height: '100%', borderRadius: 3 },
  factorExplanation: {
    fontSize: 11,
    color: GP.textSecondary,
    lineHeight: 16,
    marginTop: 6,
  },

  card: {
    backgroundColor: GP.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GP.border,
    padding: 16,
  },
});
