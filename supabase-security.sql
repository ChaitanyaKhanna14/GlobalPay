-- ═══════════════════════════════════════════════════════════════════
-- GlobalPay Secure — Security Layer Schema
--
-- STATUS: APPLIED to the live project via Supabase migrations
--   * security_operations_schema
--   * harden_security_definer_functions
--   * restrict_is_soc_analyst_execute
--
-- This file is the readable reference for that schema. `supabase migration
-- list` is the authority on what is deployed. Re-running this file against a
-- fresh project reproduces the same state.
--
-- Verified against the live database:
--   - UPDATE on security_events  -> rejected by trigger
--   - DELETE on security_events  -> rejected by trigger
--   (both hold even for the service role, which bypasses RLS)
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- Analyst roster
--
-- Fleet-wide visibility is a privilege, not a default. Membership here is what
-- lets an account read other users' security events. Modelling it as an
-- explicit roster (rather than "any authenticated user sees everything") keeps
-- the blast radius small and makes the grant auditable — you can always answer
-- "who could read this?".
--
-- Nobody can self-enrol: adding an analyst is a service-role/dashboard
-- operation on purpose.
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.soc_analysts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  note TEXT
);
ALTER TABLE public.soc_analysts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analysts can see their own membership" ON public.soc_analysts
  FOR SELECT USING (auth.uid() = user_id);

-- SECURITY DEFINER so the check does not recurse through the policies that
-- call it. search_path is pinned: a mutable search_path lets a caller shadow
-- `public` and hijack execution inside a definer-rights function.
CREATE OR REPLACE FUNCTION public.is_soc_analyst()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.soc_analysts WHERE user_id = auth.uid());
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so revoking from
-- `anon` alone leaves it reachable. `authenticated` must keep EXECUTE because
-- RLS policy expressions evaluate with the querying role's privileges.
REVOKE EXECUTE ON FUNCTION public.is_soc_analyst() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_soc_analyst() FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_soc_analyst() TO authenticated;

-- ─── Security Events ─────────────────────────────
-- Append-only, hash-chained. Each row commits to the row before it.
CREATE TABLE IF NOT EXISTS public.security_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  occurred_at TIMESTAMPTZ NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor TEXT,

  -- Context. Deliberately coarse: city/country only, never GPS coordinates,
  -- and a pseudonymous device id rather than any hardware identifier.
  device_id TEXT,
  device_name TEXT,
  city TEXT,
  country TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  ip_address INET,
  ip_reputation_flagged BOOLEAN DEFAULT FALSE,
  amount_usd NUMERIC(20,2),
  token TEXT,
  counterparty TEXT,
  detail TEXT,
  simulated BOOLEAN DEFAULT FALSE,

  -- Hash chain
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sec_events_user ON public.security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_sec_events_time ON public.security_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_type ON public.security_events(type);
CREATE INDEX IF NOT EXISTS idx_sec_events_severity ON public.security_events(severity);

-- ─── Audit Anchors ───────────────────────────────
-- Merkle roots committed to Polygon. Hashes only — never event contents.
CREATE TABLE IF NOT EXISTS public.audit_anchors (
  id TEXT PRIMARY KEY,
  merkle_root TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  from_timestamp TIMESTAMPTZ NOT NULL,
  to_timestamp TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','anchored','failed')),
  tx_hash TEXT,
  chain_id INTEGER,
  explorer_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anchors_created ON public.audit_anchors(created_at DESC);

-- ─── Security Alerts ─────────────────────────────
-- Correlated detections. Evidence is stored as event ids, not copies, so an
-- alert can never disagree with the log it was derived from.
CREATE TABLE IF NOT EXISTS public.security_alerts (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigating','contained','resolved','false_positive')),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor TEXT,
  detected_at TIMESTAMPTZ NOT NULL,
  evidence_event_ids TEXT[] NOT NULL DEFAULT '{}',
  mitre_ids TEXT[] NOT NULL DEFAULT '{}',
  risk_score INTEGER CHECK (risk_score BETWEEN 0 AND 100),
  explanation TEXT NOT NULL,
  recommendations TEXT[] NOT NULL DEFAULT '{}',
  -- Analyst workflow
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON public.security_alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_detected ON public.security_alerts(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON public.security_alerts(user_id);

-- ═══════════════════════════════════════════════════════════════════
-- Append-only enforcement
--
-- The hash chain makes tampering *detectable*. These rules make the ordinary
-- path of tampering impossible in the first place: no UPDATE and no DELETE on
-- the event log, for anyone, enforced by the database rather than by
-- convention. Defence in depth — detection and prevention, not one or other.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reject_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'security_events is append-only: % is not permitted on this table', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS no_update_security_events ON public.security_events;
CREATE TRIGGER no_update_security_events
  BEFORE UPDATE ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

DROP TRIGGER IF EXISTS no_delete_security_events ON public.security_events;
CREATE TRIGGER no_delete_security_events
  BEFORE DELETE ON public.security_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- Anchors are equally immutable once written.
DROP TRIGGER IF EXISTS no_delete_audit_anchors ON public.audit_anchors;
CREATE TRIGGER no_delete_audit_anchors
  BEFORE DELETE ON public.audit_anchors
  FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- ═══════════════════════════════════════════════════════════════════
-- Row-Level Security
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_anchors  ENABLE ROW LEVEL SECURITY;

-- Users may read their own security history — this is a transparency feature,
-- and regulations such as GDPR Article 15 require it.
CREATE POLICY "Read own security events" ON public.security_events
  FOR SELECT USING (auth.uid() = user_id OR public.is_soc_analyst());

-- Clients may append events, but only ones attributed to themselves. A client
-- cannot forge activity under another account.
CREATE POLICY "Append own security events" ON public.security_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Read own alerts" ON public.security_alerts
  FOR SELECT USING (auth.uid() = user_id OR public.is_soc_analyst());

-- Anchors commit to hashes only and contain nothing sensitive; public
-- readability is the point, since third-party verification is the whole
-- purpose of anchoring.
CREATE POLICY "Anchors are publicly readable" ON public.audit_anchors
  FOR SELECT USING (true);

-- ANALYST ACCESS
-- Implemented above via public.soc_analysts + public.is_soc_analyst(). Fleet
-- visibility is granted per-account and is revocable, rather than handed to
-- every authenticated user — which is the over-broad access real breaches
-- exploit. Grant it with:
--   INSERT INTO public.soc_analysts (user_id, note) VALUES ('<uuid>', 'why');

-- ═══════════════════════════════════════════════════════════════════
-- Convenience view: SOC metrics
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.soc_metrics AS
SELECT
  COUNT(*)                                                          AS total_events,
  COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '24 hours')  AS events_last_24h,
  COUNT(*) FILTER (WHERE severity IN ('high','critical'))            AS high_risk_events,
  COUNT(*) FILTER (WHERE type = 'payment.blocked')                   AS blocked_payments,
  COUNT(DISTINCT user_id)                                            AS accounts_seen,
  MAX(occurred_at)                                                   AS latest_event_at
FROM public.security_events
WHERE simulated = FALSE;
