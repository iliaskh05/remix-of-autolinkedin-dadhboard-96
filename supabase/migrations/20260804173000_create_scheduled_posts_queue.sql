-- Option 2: dedicated queue table for one-shot scheduled LinkedIn publishes.
-- Recurring recipes stay in `schedules` + `run-schedules`; this table is the
-- durable backlog consumed by the `publish-scheduled-posts` Edge Function.

CREATE TABLE IF NOT EXISTS public.scheduled_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  image_url TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  error_message TEXT,
  linkedin_post_id TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due
  ON public.scheduled_posts (status, scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_user_created
  ON public.scheduled_posts (user_id, created_at DESC);

CREATE TRIGGER trg_scheduled_posts_updated
  BEFORE UPDATE ON public.scheduled_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scheduled posts select own"
  ON public.scheduled_posts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Scheduled posts insert own"
  ON public.scheduled_posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Scheduled posts update own"
  ON public.scheduled_posts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Scheduled posts delete own"
  ON public.scheduled_posts FOR DELETE
  USING (auth.uid() = user_id);

-- Move any one-shot posts that were still waiting in the legacy `posts` queue
-- so nothing is lost when Composer switches to `scheduled_posts`.
INSERT INTO public.scheduled_posts (
  user_id, title, content, image_url, scheduled_at, status, linkedin_post_id, created_at
)
SELECT
  p.user_id,
  COALESCE(p.title, ''),
  p.content,
  p.image_url,
  p.scheduled_at,
  'scheduled',
  p.linkedin_post_id,
  p.created_at
FROM public.posts p
WHERE p.status = 'scheduled'
  AND p.scheduled_at IS NOT NULL
  AND p.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.scheduled_posts sp
    WHERE sp.user_id = p.user_id
      AND sp.content = p.content
      AND sp.scheduled_at = p.scheduled_at
  );
