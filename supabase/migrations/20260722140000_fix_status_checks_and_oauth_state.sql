-- Phase 0 security/audit fixes
-- 1) posts.status CHECK never included 'scheduled', even though the app
--    (Composer, publish-scheduled) has always used that status.
-- 2) content_sources.source_type CHECK never included 'idea', even though
--    schedules (adhoc_sources / saved_source_ids) reference it.
-- 3) New columns on user_settings to persist the LinkedIn OAuth `state` for
--    CSRF validation between get_auth_url and exchange_code.

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('draft', 'generating', 'ready', 'scheduled', 'published', 'failed'));

ALTER TABLE public.content_sources DROP CONSTRAINT IF EXISTS content_sources_source_type_check;
ALTER TABLE public.content_sources ADD CONSTRAINT content_sources_source_type_check
  CHECK (source_type IN ('url', 'keyword', 'idea'));

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS linkedin_oauth_state TEXT;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS linkedin_oauth_state_expires_at TIMESTAMPTZ;
