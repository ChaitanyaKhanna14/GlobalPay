-- Fiat Transactions - Deposit (bank → crypto) and Withdraw (crypto → bank)
-- Run this in Supabase SQL Editor after the linked-accounts migration

CREATE TABLE IF NOT EXISTS public.fiat_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw')),
  amount TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  token TEXT NOT NULL DEFAULT 'USDC',         -- crypto side
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  reference TEXT,                              -- external reference / receipt ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fiat_tx_user ON public.fiat_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_fiat_tx_bank ON public.fiat_transactions(bank_account_id);

-- RLS
ALTER TABLE public.fiat_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own fiat transactions" ON public.fiat_transactions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own fiat transactions" ON public.fiat_transactions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own fiat transactions" ON public.fiat_transactions
  FOR UPDATE USING (user_id = auth.uid());
