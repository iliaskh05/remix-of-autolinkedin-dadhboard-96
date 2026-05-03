-- Add scheduling support to posts
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON public.posts (status, scheduled_at) WHERE status = 'scheduled';

-- Storage policies for the post-assets bucket so users can upload their own images under {userId}/...
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Post assets read public') THEN
    CREATE POLICY "Post assets read public" ON storage.objects FOR SELECT USING (bucket_id = 'post-assets');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Post assets insert own') THEN
    CREATE POLICY "Post assets insert own" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'post-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Post assets update own') THEN
    CREATE POLICY "Post assets update own" ON storage.objects FOR UPDATE USING (bucket_id = 'post-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Post assets delete own') THEN
    CREATE POLICY "Post assets delete own" ON storage.objects FOR DELETE USING (bucket_id = 'post-assets' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

-- Enable extensions for cron-driven scheduled publish
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;