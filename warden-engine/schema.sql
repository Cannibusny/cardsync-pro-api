-- Warden Engine Database Schema
-- Run in Supabase SQL Editor for project: peggccsshifakrfuyowi

CREATE TABLE IF NOT EXISTS public.warden_transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ NOT NULL    DEFAULT now(),
  requesting_agent TEXT        NOT NULL,
  target_service   TEXT        NOT NULL,
  payload_data     JSONB       NOT NULL,
  status           TEXT        NOT NULL    DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','APPROVED','DENIED','EXECUTED','FAILED')),
  resolution_notes TEXT,
  security_hash    TEXT        NOT NULL
);

ALTER TABLE public.warden_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.warden_transactions
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_warden_status ON public.warden_transactions (status);
CREATE INDEX IF NOT EXISTS idx_warden_hash   ON public.warden_transactions (security_hash);
