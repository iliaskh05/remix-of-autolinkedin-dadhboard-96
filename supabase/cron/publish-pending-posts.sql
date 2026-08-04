-- =============================================================================
-- Cron: drain the `scheduled_posts` queue every 15 minutes
-- Run this in the Supabase SQL Editor AFTER after deploying the Edge Function.
-- =============================================================================
-- Replace the two placeholders below:
--   1) YOUR_PROJECT_REF  → Project Settings → General → Reference ID
--   2) YOUR_CRON_SECRET  → same value as the Edge Function secret CRON_SECRET
--      (Dashboard → Edge Functions → Secrets, or `supabase secrets set CRON_SECRET=...`)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Idempotent: drop previous job if it already exists, then recreate.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-pending-posts') THEN
    PERFORM cron.unschedule('publish-pending-posts');
  END IF;
END $$;

SELECT cron.schedule(
  'publish-pending-posts',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/publish-scheduled-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);

-- Verify the job is registered:
-- SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'publish-pending-posts';

-- Manual smoke test (same as one cron tick):
-- SELECT net.http_post(
--   url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/publish-scheduled-posts',
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'x-cron-secret', 'YOUR_CRON_SECRET'
--   ),
--   body := '{}'::jsonb
-- );
