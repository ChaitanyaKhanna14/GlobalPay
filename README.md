# GlobalPay Secure

A non-custodial cross-border payment application with an integrated security
operations layer — built to stand as both a **blockchain** project and a
**cybersecurity** project, with each half load-bearing rather than decorative.

| | |
|---|---|
| **Payments** | Non-custodial Polygon wallet, USDC/USDT/POL transfers, GlobalPay IDs, QR pay, UPI, payment requests |
| **Security** | Risk-based authentication, explainable fraud scoring, threat detection mapped to MITRE ATT&CK, SOC console |
| **Blockchain** | Non-custodial key custody **and** a tamper-evident audit log anchored to Polygon as a Merkle root |

---

## Quick start

```bash
npm install
npm start          # then press w for web, a for Android, i for iOS
```

Other commands:

```bash
npm run web        # web directly
npm test           # 51 tests over the security layer
npm run typecheck  # tsc --noEmit
npm run lint
```

Requires a `.env` with:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
EXPO_PUBLIC_POLYGON_RPC_URL=...     # only needed for mainnet
EXPO_PUBLIC_SENTRY_DSN=...          # optional
```

> There is no `npm run dev` script — use `npm start` or `npm run web`.

### Database

Run these in the Supabase SQL editor, in order:

1. `supabase-schema.sql` — users, transactions, payment requests
2. `supabase-linked-accounts.sql`, `supabase-upi.sql`, `supabase-fiat-transactions.sql`, `supabase-push-tokens.sql`
3. `supabase-security.sql` — security events, alerts, audit anchors *(optional; the SOC runs on-device without it)*

---

## The Security Operations Center

Open **Profile → Security Center**, or navigate to `/soc`.

| Screen | Purpose |
|---|---|
| `/soc` | Live metrics, alert feed, event stream, attack simulator, device/fleet toggle |
| `/soc/[alertId]` | Incident report: triage workflow, risk breakdown, attack replay, ATT&CK mapping, response steps |
| `/soc/mitre` | ATT&CK coverage matrix — techniques covered vs. actually observed |
| `/soc/integrity` | Hash chain state, anchored Merkle roots, integrity verification |

### Fleet monitoring (two or more devices)

Every device keeps its own hash-chained log locally and mirrors events to
Supabase. The console's **This device / Fleet** toggle switches which population
it monitors.

What "Fleet" returns is decided by Row-Level Security, not by the toggle: an
ordinary account sees only its own rows, an account listed in `soc_analysts`
sees everyone's. The switch picks the query; the database picks the answer.

Grant fleet visibility to an account:

```sql
INSERT INTO public.soc_analysts (user_id, note)
VALUES ('<auth.users uuid>', 'why this person has fleet access');
```

Revoke it by deleting the row. Because it is an explicit roster rather than
"any signed-in user sees everything", you can always answer *"who could read
this?"* — which is the question that matters after an incident.

The local chain stays the source of truth for integrity, deliberately. If the
server assigned ordering, concurrent appends from two devices would interleave
into one chain and verification would depend on network round-trips, making a
dropped request indistinguishable from tampering. Local means integrity,
Supabase means visibility — and the tamper demo still works offline.

### Demonstrating it

The console ships with an attack simulator so detections can be shown without
mounting a real attack. It writes synthetic entries into the app's own event
log — it sends no network traffic and cannot be pointed at another system.

A good five-minute walkthrough:

1. Open `/soc` → **Attack Simulation** → run **Normal Activity** (nothing fires — this is the control case).
2. Run **Account Takeover Chain** → a critical alert appears.
3. Open the alert → press **Replay** to watch the kill chain unfold one step at a time.
4. Scroll to the risk breakdown → **72/100**, with every contributing factor and its reason.
5. Move the alert through triage: *Investigating* → *Resolved*. The open-alert count drops.
6. Visit `/soc/mitre` → the coverage matrix marks the techniques that just fired in red.
7. Go to `/soc/integrity` → **Seal root locally** → status becomes *Integrity verified*.
8. Switch the console to **Fleet** → events from every permitted account appear in one stream.
9. Edit any stored event → re-check → **Tampering detected**, naming the exact event that broke.

Step 9 is the point of the blockchain layer, and it is worth doing live.

Two further guarantees are worth showing directly in the Supabase SQL editor,
because they hold at the database level rather than in application code:

```sql
UPDATE public.security_events SET severity = 'info' WHERE id = '<any id>';
DELETE FROM public.security_events WHERE id = '<any id>';
```

Both are rejected by append-only triggers — and they stay rejected for the
service role, which bypasses RLS entirely. The hash chain makes tampering
*detectable*; these triggers make the ordinary path of tampering *impossible*.

---

## How the pieces fit

```
User action (login / payment)
        │
        ▼
Authentication  ── password · OTP · biometric · PIN (salted hash, progressive lockout)
        │
        ▼
Risk engine     ── 8 explainable factors, scored against the account's OWN prior history
        │
        ├── < 25   → allow
        ├── 25–49  → monitor
        ├── 50–74  → challenge (step-up auth)
        └── ≥ 75   → block
        │
        ▼
Security event → hash-chained into the append-only audit log
        │
        ├──► Detection rules correlate across the stream → alerts → SOC console
        │
        └──► Merkle root anchored on Polygon → tamper-evident audit trail
```

The risk engine is not advisory: `app/send.tsx` consults it before a transfer is
confirmed, blocks at critical risk, and demands step-up authentication at high
risk.

---

## Why blockchain, precisely

Blockchain provides **integrity, immutability and non-repudiation**. It does not
encrypt anything and it does not protect data in transit — TLS does that, and
hardware-backed keystores protect data at rest.

So GlobalPay Secure anchors **hashes only**. No event contents, personal data,
balances, or wallet addresses are ever published on-chain.

Two mechanisms, each covering the other's blind spot:

1. **Hash chain** — every event commits to its predecessor, so editing one
   breaks every link after it. Catches casual tampering instantly.
2. **Anchored Merkle root** — a sophisticated attacker can edit an event *and*
   recompute every subsequent hash, defeating mechanism 1. They cannot rewrite a
   confirmed Polygon transaction, so the recomputed root stops matching and the
   tampering is proven.

Both claims have tests. See `tests/audit-chain.test.ts`:
`detects an edited event` and
`catches a tampered log even after every hash is recomputed`.

---

## Project layout

```
app/                     screens (expo-router file-based routing)
  (auth)/                login, signup, OTP, password reset
  (tabs)/                home, activity, profile
  soc/                   Security Operations Center
services/
  security/              ← the security layer
    event-log.ts         hash-chained append-only log
    risk-engine.ts       explainable scoring (pure, portable)
    detection-rules.ts   temporal correlation → alerts
    blockchain-anchor.ts Merkle tree + Polygon anchoring
    attack-simulator.ts  synthetic scenarios for demos and tests
    alert-status.ts      analyst triage workflow
    anchor-submitter.ts  publishes a root to Polygon
    input-guard.ts       injection detection feeding the SOC
    context-provider.ts  pseudonymous device + context capture
    instrument.ts        one-line helpers the app calls
    soc-service.ts       facade the UI talks to
  wallet.ts              non-custodial Polygon wallet
  secure-storage.ts      platform-aware secret storage
tests/                   vitest suite over the security layer
docs/SECURITY-ARCHITECTURE.md
```

---

## Documentation

**[docs/SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md)** covers the
threat model, the risk-factor table, the detection-rule catalogue with ATT&CK
mappings, and — importantly — a frank **Known Limitations** section covering
client-side scoring, local storage, and the bounds of impossible-travel
detection.
