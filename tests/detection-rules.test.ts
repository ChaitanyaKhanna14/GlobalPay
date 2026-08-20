import { describe, expect, it } from 'vitest';
import { RULES, runDetections } from '@/services/security/detection-rules';
import { buildScenario } from '@/services/security/attack-simulator';
import { categoryOf, type SecurityEvent, type SecurityEventType } from '@/types/security';

const USER = 'user-1';
const BASE = new Date(new Date().setHours(12, 0, 0, 0)).getTime();

function event(
  type: SecurityEventType,
  msBefore: number,
  context: SecurityEvent['context'] = {},
  userId = USER,
): SecurityEvent {
  return {
    id: `e${msBefore}_${Math.random()}`,
    type,
    category: categoryOf(type),
    severity: 'info',
    timestamp: new Date(BASE - msBefore).toISOString(),
    userId,
    context,
    prevHash: '0x0',
    hash: '0x1',
  };
}

/** Convert simulator output into events the detection engine can consume. */
function materialise(scenario: Parameters<typeof buildScenario>[0]): SecurityEvent[] {
  return buildScenario(scenario, { userId: USER, actor: 'demo@globalpay' }).map((input, i) => ({
    id: `sim_${i}`,
    type: input.type,
    category: categoryOf(input.type),
    severity: input.severity ?? 'info',
    timestamp: input.timestamp!,
    userId: input.userId,
    actor: input.actor,
    context: input.context ?? {},
    prevHash: '0x0',
    hash: `0x${i}`,
  }));
}

describe('rule catalogue', () => {
  it('gives every rule a MITRE mapping and remediation steps', () => {
    for (const rule of Object.values(RULES)) {
      expect(rule.mitre.length, `${rule.id} needs MITRE mapping`).toBeGreaterThan(0);
      expect(rule.recommendations.length, `${rule.id} needs recommendations`).toBeGreaterThan(0);
      for (const technique of rule.mitre) {
        expect(technique.id).toMatch(/^T\d{4}(\.\d{3})?$/);
        expect(technique.url).toContain('attack.mitre.org');
      }
    }
  });
});

describe('quiet by default', () => {
  it('fires nothing on an empty log', () => {
    expect(runDetections([])).toHaveLength(0);
  });

  it('fires nothing on ordinary activity', () => {
    const alerts = runDetections(materialise('normal_activity'));
    expect(alerts).toHaveLength(0);
  });

  it('does not fire credential stuffing below the threshold', () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      event('auth.login.failure', 60_000 - i * 1000),
    );
    expect(runDetections(events).some((a) => a.ruleId === 'credential_stuffing')).toBe(false);
  });

  it('does not fire when many failures are spread over hours', () => {
    // 20 failures, but one every 30 minutes — a forgetful user, not an attack.
    const events = Array.from({ length: 20 }, (_, i) =>
      event('auth.login.failure', i * 30 * 60_000),
    );
    expect(runDetections(events).some((a) => a.ruleId === 'credential_stuffing')).toBe(false);
  });
});

describe('scenario detections', () => {
  it('detects credential stuffing', () => {
    const alerts = runDetections(materialise('credential_stuffing'));
    const alert = alerts.find((a) => a.ruleId === 'credential_stuffing');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('critical');
    expect(alert!.evidence.length).toBeGreaterThanOrEqual(10);
    expect(alert!.mitre.map((m) => m.id)).toContain('T1110.004');
  });

  it('detects impossible travel', () => {
    const alerts = runDetections(materialise('impossible_travel'));
    const alert = alerts.find((a) => a.ruleId === 'impossible_travel');
    expect(alert).toBeDefined();
    expect(alert!.evidence).toHaveLength(2);
    expect(alert!.explanation).toMatch(/km\/h/);
  });

  it('detects the account takeover chain', () => {
    const alerts = runDetections(materialise('account_takeover'));
    const alert = alerts.find((a) => a.ruleId === 'account_takeover_chain');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('critical');
    // login → credential change → transfer
    expect(alert!.evidence).toHaveLength(3);
  });

  it('detects wallet draining and key export', () => {
    const alerts = runDetections(materialise('wallet_draining'));
    expect(alerts.some((a) => a.ruleId === 'payment_velocity')).toBe(true);
    expect(alerts.some((a) => a.ruleId === 'key_exfiltration')).toBe(true);
  });

  it('detects PIN brute force', () => {
    const alerts = runDetections(materialise('pin_brute_force'));
    const alert = alerts.find((a) => a.ruleId === 'brute_force_pin');
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('high');
  });

  it('detects injection probes, one alert per payload', () => {
    const alerts = runDetections(materialise('injection_probe'));
    const injection = alerts.filter((a) => a.ruleId === 'injection_attempt');
    expect(injection.length).toBeGreaterThanOrEqual(4);
    expect(injection[0].mitre.map((m) => m.id)).toContain('T1190');
  });
});

describe('correlation hygiene', () => {
  it('does not correlate events belonging to different users', () => {
    // Ten failures, but spread across ten different accounts — not one account
    // under attack, so the per-account rule must stay silent.
    const events = Array.from({ length: 10 }, (_, i) =>
      event('auth.login.failure', 60_000 - i * 1000, {}, `user-${i}`),
    );
    expect(runDetections(events).some((a) => a.ruleId === 'credential_stuffing')).toBe(false);
  });

  it('produces stable alert IDs across repeated runs', () => {
    const events = materialise('account_takeover');
    const first = runDetections(events).map((a) => a.id);
    const second = runDetections(events).map((a) => a.id);
    expect(first).toEqual(second);
  });

  it('orders alerts newest first', () => {
    const events = [...materialise('credential_stuffing'), ...materialise('injection_probe')];
    const alerts = runDetections(events);
    const times = alerts.map((a) => new Date(a.detectedAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('attaches evidence to every alert it raises', () => {
    const events = [
      ...materialise('account_takeover'),
      ...materialise('credential_stuffing'),
      ...materialise('wallet_draining'),
    ];
    for (const alert of runDetections(events)) {
      expect(alert.evidence.length, `${alert.ruleId} must cite evidence`).toBeGreaterThan(0);
      expect(alert.explanation.length).toBeGreaterThan(40);
    }
  });
});
