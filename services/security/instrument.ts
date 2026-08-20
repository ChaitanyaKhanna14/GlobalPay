/**
 * Instrumentation helpers.
 *
 * These are the functions the *payment* app calls. They exist so that adding
 * security telemetry to a screen never means importing the event log, knowing
 * the taxonomy, or assembling a context object by hand — the call sites stay
 * one line, which is the only way instrumentation actually gets adopted.
 *
 * Every helper is fire-and-forget and swallows its own errors: logging that a
 * payment happened must never be able to break the payment.
 */
import { logSecurityEvent } from './soc-service';
import { baseContext } from './context-provider';
import type { EventContext, SecurityEventType, Severity } from '@/types/security';

interface EmitOptions {
  userId?: string;
  actor?: string;
  severity?: Severity;
  context?: EventContext;
}

/**
 * Record an event without ever throwing.
 *
 * Security telemetry is strictly secondary to the user's actual task. If the
 * event log is full, storage is unavailable, or serialisation fails, the
 * payment or login must still succeed — so failures are logged in development
 * and dropped in production rather than propagated.
 */
async function emit(type: SecurityEventType, options: EmitOptions = {}): Promise<void> {
  try {
    await logSecurityEvent({
      type,
      userId: options.userId ?? 'anonymous',
      actor: options.actor,
      severity: options.severity,
      context: await baseContext(options.context),
    });
  } catch (e) {
    __DEV__ && console.warn(`[Security] Failed to record ${type}:`, e);
  }
}

// ─── Authentication ─────────────────────────────

export function recordLoginSuccess(userId: string, actor?: string): void {
  void emit('auth.login.success', { userId, actor });
}

export function recordLoginFailure(attemptedIdentifier?: string, reason?: string): void {
  // The attempted identifier is recorded, never the attempted password — and
  // it is truncated, because a failed login is frequently a *password* typed
  // into the username box by mistake.
  void emit('auth.login.failure', {
    context: {
      detail: [
        attemptedIdentifier ? `identifier: ${attemptedIdentifier.slice(0, 24)}` : null,
        reason,
      ]
        .filter(Boolean)
        .join(' · '),
    },
  });
}

export function recordLogout(userId: string, actor?: string): void {
  void emit('auth.logout', { userId, actor });
}

export function recordPasswordChange(userId: string, actor?: string): void {
  void emit('auth.password.change', { userId, actor });
}

export function recordPasswordResetRequest(email?: string): void {
  void emit('auth.password.reset_request', {
    context: { detail: email ? `reset requested for ${email.slice(0, 32)}` : undefined },
  });
}

export function recordEmailChange(userId: string, actor?: string): void {
  void emit('account.email_change', { userId, actor });
}

export function recordAccountDeleted(userId: string, actor?: string): void {
  void emit('account.deleted', { userId, actor });
}

// ─── App lock / PIN ─────────────────────────────

export function recordPinFailure(userId: string, attemptsRemaining?: number): void {
  void emit('pin.failure', {
    userId,
    context: {
      detail:
        attemptsRemaining != null
          ? `${attemptsRemaining} attempt(s) remaining before lockout`
          : undefined,
    },
  });
}

export function recordPinSuccess(userId: string): void {
  void emit('pin.success', { userId });
}

export function recordPinLockout(userId: string, minutes: number): void {
  void emit('pin.lockout', {
    userId,
    context: { detail: `Progressive lockout engaged for ${minutes} minutes` },
  });
}

export function recordBiometricSuccess(userId: string): void {
  void emit('biometric.success', { userId });
}

export function recordBiometricFailure(userId: string): void {
  void emit('biometric.failure', { userId });
}

// ─── Payments ───────────────────────────────────

interface PaymentContext {
  amountUsd?: number;
  token?: string;
  counterparty?: string;
  detail?: string;
}

export function recordPaymentInitiated(
  userId: string,
  payment: PaymentContext,
  actor?: string,
): void {
  void emit('payment.initiated', { userId, actor, context: payment });
}

export function recordPaymentCompleted(
  userId: string,
  payment: PaymentContext,
  actor?: string,
): void {
  void emit('payment.completed', { userId, actor, context: payment });
}

export function recordPaymentFailed(
  userId: string,
  payment: PaymentContext,
  actor?: string,
): void {
  void emit('payment.failed', { userId, actor, context: payment });
}

/** A payment the risk engine refused outright. */
export function recordPaymentBlocked(
  userId: string,
  payment: PaymentContext & { riskScore: number },
  actor?: string,
): void {
  void emit('payment.blocked', {
    userId,
    actor,
    context: {
      ...payment,
      detail: `Blocked by risk engine (score ${payment.riskScore}/100)${
        payment.detail ? ` — ${payment.detail}` : ''
      }`,
    },
  });
}

/** A payment that required step-up authentication before proceeding. */
export function recordPaymentChallenged(
  userId: string,
  payment: PaymentContext & { riskScore: number },
  actor?: string,
): void {
  void emit('payment.challenged', {
    userId,
    actor,
    context: {
      ...payment,
      detail: `Step-up authentication required (risk ${payment.riskScore}/100)`,
    },
  });
}

// ─── Wallet ─────────────────────────────────────

export function recordWalletCreated(userId: string, actor?: string): void {
  void emit('wallet.created', { userId, actor });
}

export function recordWalletImported(userId: string, actor?: string): void {
  void emit('wallet.imported', { userId, actor });
}

/**
 * Private key or recovery phrase export.
 *
 * Always high severity even when legitimate: GlobalPay wallets are
 * non-custodial, so whoever holds the key holds the funds outright and no
 * server-side control can reverse a theft that follows.
 */
export function recordKeyExported(userId: string, actor?: string): void {
  void emit('wallet.key_exported', { userId, actor, severity: 'high' });
}

// ─── Application-layer attacks ──────────────────

export function recordInjectionAttempt(field: string, payload: string): void {
  void emit('appsec.injection_attempt', {
    context: { detail: `Rejected in "${field}": ${payload.slice(0, 60)}` },
  });
}
