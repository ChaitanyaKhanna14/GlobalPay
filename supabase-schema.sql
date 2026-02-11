-- GlobalPay Database Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard
-- This script drops existing tables and recreates them cleanly.

-- ─── Drop existing tables (CASCADE removes policies & indexes) ───
DROP TABLE IF EXISTS public.payment_requests CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- ─── Users Table ─────────────────────────────────
-- Stores user profiles with GlobalPay IDs mapped to wallet addresses
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  global_pay_id TEXT UNIQUE NOT NULL,        -- e.g. "rahul@globalpay"
  wallet_address TEXT UNIQUE NOT NULL,        -- Polygon wallet address
  avatar_url TEXT,
  preferred_token TEXT DEFAULT 'USDC',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast GlobalPay ID lookups
CREATE INDEX IF NOT EXISTS idx_users_global_pay_id ON public.users(global_pay_id);
CREATE INDEX IF NOT EXISTS idx_users_wallet_address ON public.users(wallet_address);

-- ─── Transactions Table ──────────────────────────
-- Records all on-chain transactions for history & analytics
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  from_global_pay_id TEXT,
  to_global_pay_id TEXT,
  amount TEXT NOT NULL,
  token TEXT NOT NULL,                        -- e.g. USDC, ETH, MATIC
  amount_usd TEXT,
  fee TEXT,
  fee_usd TEXT,
  tx_hash TEXT,                               -- blockchain transaction hash
  note TEXT,
  status TEXT DEFAULT 'confirmed',            -- pending | confirmed | failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transactions_from ON public.transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_transactions_to ON public.transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON public.transactions(created_at DESC);

-- ─── Payment Requests ────────────────────────────
-- Money request feature (like Venmo requests)
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_global_pay_id TEXT NOT NULL,           -- who is requesting
  to_global_pay_id TEXT NOT NULL,             -- who should pay
  amount TEXT NOT NULL,
  token TEXT NOT NULL,
  note TEXT,
  status TEXT DEFAULT 'pending',              -- pending | paid | declined | expired
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_to ON public.payment_requests(to_global_pay_id);
CREATE INDEX IF NOT EXISTS idx_requests_from ON public.payment_requests(from_global_pay_id);

-- ─── Row Level Security ──────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- Users can read all users (for ID lookups) but only update their own
CREATE POLICY "Users are publicly readable" ON public.users
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Transactions: users can read their own, anyone can insert
CREATE POLICY "Users can read own transactions" ON public.transactions
  FOR SELECT USING (
    from_address IN (SELECT wallet_address FROM public.users WHERE id = auth.uid())
    OR to_address IN (SELECT wallet_address FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Authenticated users can insert transactions" ON public.transactions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Payment requests: users can read requests involving them
CREATE POLICY "Users can read own requests" ON public.payment_requests
  FOR SELECT USING (
    from_global_pay_id IN (SELECT global_pay_id FROM public.users WHERE id = auth.uid())
    OR to_global_pay_id IN (SELECT global_pay_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Authenticated users can insert requests" ON public.payment_requests
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update requests sent to them" ON public.payment_requests
  FOR UPDATE USING (
    to_global_pay_id IN (SELECT global_pay_id FROM public.users WHERE id = auth.uid())
  );
