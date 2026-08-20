/**
 * Input validation and injection detection.
 *
 * ── This is not the defence ──
 * The actual protection against SQL injection is parameterised queries, and we
 * already have them: the Supabase client binds every value rather than
 * concatenating it into SQL, and Postgres Row-Level Security constrains what a
 * query can reach even if one slipped through. Pattern-matching user input is a
 * notoriously leaky way to *prevent* injection — encodings, comment tricks and
 * case games defeat any blocklist eventually.
 *
 * So this module exists for a different reason: **visibility**. Someone typing
 * `' OR '1'='1` into a recipient field is not a confused user, and a security
 * team wants to know an endpoint is being probed long before a payload
 * succeeds. Detection here feeds the SOC; prevention stays where it belongs, in
 * the data layer.
 *
 * Treat a hit as "this session is hostile", not as "we just stopped a breach".
 */
import { recordInjectionAttempt } from './instrument';

/**
 * Patterns characteristic of injection probing.
 *
 * Kept deliberately narrow. A broad blocklist produces false positives on
 * legitimate input — an apostrophe in a payment note is not an attack — and a
 * detector that cries wolf gets muted, which is worse than not having it.
 */
const INJECTION_PATTERNS: { name: string; pattern: RegExp }[] = [
  // Matches `' OR '1'='1`, `x' OR 1=1`, `1' AND '1'='1`. Quoting around either
  // operand is optional. The word-boundary anchors keep this off ordinary
  // prose: "organization" starts with "or" but has no boundary after it.
  {
    name: 'SQL tautology',
    pattern: /['"]\s*\b(or|and)\b\s*['"]?\s*\w+\s*['"]?\s*=\s*['"]?\s*\w+/i,
  },
  { name: 'SQL comment terminator', pattern: /(--|#|\/\*)\s*$/ },
  { name: 'Stacked query', pattern: /;\s*(drop|delete|update|insert|alter|truncate)\s+/i },
  { name: 'UNION SELECT', pattern: /\bunion\b[\s\S]*?\bselect\b/i },
  { name: 'SQL metadata probe', pattern: /\b(information_schema|pg_catalog|sqlite_master)\b/i },
  { name: 'Script injection', pattern: /<\s*script\b|javascript\s*:/i },
  { name: 'Template injection', pattern: /\$\{.*\}|\{\{.*\}\}/ },
  { name: 'NoSQL operator', pattern: /\$(ne|gt|lt|where|regex)\b/i },
];

export interface GuardResult {
  safe: boolean;
  /** Which pattern matched, when unsafe. */
  matched?: string;
}

/**
 * Inspect a value destined for a server-side lookup.
 *
 * Recording is a side effect on purpose: every call site that validates should
 * also feed the SOC, and making that automatic means it cannot be forgotten.
 */
export function guardInput(field: string, value: string): GuardResult {
  if (!value) return { safe: true };

  for (const { name, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(value)) {
      recordInjectionAttempt(field, value);
      return { safe: false, matched: name };
    }
  }
  return { safe: true };
}

/**
 * Structural check for the two identifier shapes the app accepts.
 *
 * An allowlist — "this is what a valid identifier looks like" — is strictly
 * stronger than a blocklist, because it rejects everything unanticipated rather
 * than only what someone thought to forbid. `guardInput` exists alongside it
 * purely to distinguish a typo from a deliberate probe for the SOC feed.
 */
const GLOBALPAY_ID = /^[a-z0-9_.-]{3,30}@globalpay$/i;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function isValidRecipient(value: string): boolean {
  const trimmed = value.trim();
  return GLOBALPAY_ID.test(trimmed) || EVM_ADDRESS.test(trimmed);
}
