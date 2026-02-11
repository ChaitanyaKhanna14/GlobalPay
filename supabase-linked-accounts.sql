-- GlobalPay Linked Accounts Migration
-- Run this in Supabase SQL Editor AFTER the main schema

-- ─── Linked External Wallets ─────────────────────
-- Stores external wallet addresses (Bitcoin, Ethereum mainnet, etc.)
CREATE TABLE IF NOT EXISTS public.linked_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                        -- e.g. "My Bitcoin Wallet"
  network TEXT NOT NULL,                      -- e.g. "bitcoin", "ethereum"
  address TEXT NOT NULL,                      -- wallet address
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linked_wallets_user ON public.linked_wallets(user_id);

-- ─── Linked Bank Accounts ────────────────────────
-- Stores bank account details for fiat on/off ramp
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  account_number TEXT NOT NULL,               -- encrypted/masked in app
  routing_number TEXT,                        -- ACH routing (US) or IFSC (India)
  account_type TEXT DEFAULT 'checking',       -- checking | savings
  currency TEXT DEFAULT 'USD',                -- USD, INR, EUR, etc.
  is_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON public.bank_accounts(user_id);

-- ─── Row Level Security ──────────────────────────
ALTER TABLE public.linked_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

-- Linked wallets: users can only CRUD their own
CREATE POLICY "Users can read own linked wallets" ON public.linked_wallets
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own linked wallets" ON public.linked_wallets
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own linked wallets" ON public.linked_wallets
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own linked wallets" ON public.linked_wallets
  FOR DELETE USING (user_id = auth.uid());

-- Bank accounts: users can only CRUD their own
CREATE POLICY "Users can read own bank accounts" ON public.bank_accounts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can insert own bank accounts" ON public.bank_accounts
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own bank accounts" ON public.bank_accounts
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete own bank accounts" ON public.bank_accounts
  FOR DELETE USING (user_id = auth.uid());
