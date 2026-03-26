-- GlobalPay UPI Integration Schema
-- Run in Supabase SQL Editor after the linked-accounts migration

-- ─── UPI Linked Banks ────────────────────────
CREATE TABLE IF NOT EXISTS public.upi_linked_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  bank_code TEXT NOT NULL,                     -- IFSC prefix (SBIN, HDFC…)
  account_number TEXT NOT NULL,                -- masked (XXXX XXXX 1234)
  account_type TEXT DEFAULT 'savings',         -- savings | current
  ifsc TEXT,
  vpa TEXT NOT NULL,                           -- e.g. "rahul@globalpay"
  phone_number TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upi_banks_user ON public.upi_linked_banks(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_upi_banks_vpa ON public.upi_linked_banks(vpa);

-- ─── UPI Transactions ────────────────────────
CREATE TABLE IF NOT EXISTS public.upi_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('send', 'receive', 'collect')),
  amount TEXT NOT NULL,
  sender_vpa TEXT NOT NULL,
  receiver_vpa TEXT NOT NULL,
  bank_account_id UUID REFERENCES public.upi_linked_banks(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  note TEXT,
  rrn TEXT,                                    -- RBI Reference Number (12 digits)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_upi_tx_user ON public.upi_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_upi_tx_rrn  ON public.upi_transactions(rrn);

-- ─── Row Level Security ──────────────────────
ALTER TABLE public.upi_linked_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upi_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own UPI banks"
  ON public.upi_linked_banks FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users manage own UPI transactions"
  ON public.upi_transactions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
