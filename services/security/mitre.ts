/**
 * MITRE ATT&CK technique catalogue.
 *
 * Only the techniques GlobalPay Secure actually detects are listed. Mapping
 * detections to ATT&CK is what lets the SOC speak the same language as the
 * rest of the industry: an analyst reading "T1110.004" knows immediately that
 * they are looking at credential stuffing, regardless of our product naming.
 *
 * Reference: https://attack.mitre.org/
 */
import type { MitreTechnique } from '@/types/security';

const t = (id: string, name: string, tactic: string): MitreTechnique => ({
  id,
  name,
  tactic,
  // Sub-techniques live at /techniques/T1110/004/ — split on the dot.
  url: `https://attack.mitre.org/techniques/${id.replace('.', '/')}/`,
});

export const MITRE = {
  BRUTE_FORCE: t('T1110', 'Brute Force', 'Credential Access'),
  PASSWORD_GUESSING: t('T1110.001', 'Password Guessing', 'Credential Access'),
  CREDENTIAL_STUFFING: t('T1110.004', 'Credential Stuffing', 'Credential Access'),
  VALID_ACCOUNTS: t('T1078', 'Valid Accounts', 'Initial Access'),
  STEAL_SESSION_COOKIE: t('T1539', 'Steal Web Session Cookie', 'Credential Access'),
  SESSION_HIJACKING: t('T1563', 'Remote Service Session Hijacking', 'Lateral Movement'),
  ACCOUNT_MANIPULATION: t('T1098', 'Account Manipulation', 'Persistence'),
  MFA_INTERCEPTION: t('T1111', 'Multi-Factor Authentication Interception', 'Credential Access'),
  MFA_REQUEST_GENERATION: t('T1621', 'Multi-Factor Authentication Request Generation', 'Credential Access'),
  EXPLOIT_PUBLIC_APP: t('T1190', 'Exploit Public-Facing Application', 'Initial Access'),
  UNSECURED_CREDENTIALS: t('T1552', 'Unsecured Credentials', 'Credential Access'),
  CREDENTIALS_FROM_PASSWORD_STORES: t('T1555', 'Credentials from Password Stores', 'Credential Access'),
  EXFIL_OVER_C2: t('T1041', 'Exfiltration Over C2 Channel', 'Exfiltration'),
  DATA_MANIPULATION: t('T1565', 'Data Manipulation', 'Impact'),
  FINANCIAL_THEFT: t('T1657', 'Financial Theft', 'Impact'),
  IMPAIR_DEFENSES: t('T1562', 'Impair Defenses', 'Defense Evasion'),
} as const;

/** Every technique we reference, for the coverage view in the SOC. */
export const ALL_TECHNIQUES: MitreTechnique[] = Object.values(MITRE);

/** Group techniques by ATT&CK tactic for the coverage matrix. */
export function techniquesByTactic(): Record<string, MitreTechnique[]> {
  return ALL_TECHNIQUES.reduce<Record<string, MitreTechnique[]>>((acc, technique) => {
    (acc[technique.tactic] ??= []).push(technique);
    return acc;
  }, {});
}
