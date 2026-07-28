-- Phase 7 security — lightweight, best-effort rate limiting for expensive
-- AI-backed Edge Functions (text/image generation). Not a hard security
-- boundary (edge functions still enforce auth/ownership), but prevents
-- runaway costs from a buggy client or abusive user.

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON public.rate_limit_events (user_id, action, created_at DESC);

-- Only the service role (used exclusively by Edge Functions) may read/write
-- this table; no policies are defined for anon/authenticated roles.
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Best-effort housekeeping: drop events older than 1 day so the table doesn't
-- grow unbounded. Requires pg_cron (already enabled in this project).
SELECT cron.schedule(
  'cleanup-rate-limit-events',
  '0 * * * *',
  $$DELETE FROM public.rate_limit_events WHERE created_at < now() - INTERVAL '1 day'$$
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cleanup-rate-limit-events'
);
