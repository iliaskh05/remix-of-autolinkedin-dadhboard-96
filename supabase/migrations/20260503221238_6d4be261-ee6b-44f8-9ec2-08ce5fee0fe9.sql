
-- SCHEDULES table
CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  prompt text NOT NULL DEFAULT '',
  tone_instructions text,
  saved_source_ids uuid[] NOT NULL DEFAULT '{}',
  adhoc_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  days_of_week int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  hour int NOT NULL DEFAULT 9 CHECK (hour BETWEEN 0 AND 23),
  minute int NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  image_mode text NOT NULL DEFAULT 'none' CHECK (image_mode IN ('none','ai')),
  image_prompt text,
  ai_model text,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  used_urls text[] NOT NULL DEFAULT '{}',
  recent_hashes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Schedules select own" ON public.schedules FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Schedules insert own" ON public.schedules FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Schedules update own" ON public.schedules FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Schedules delete own" ON public.schedules FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_schedules_due ON public.schedules (enabled, next_run_at) WHERE enabled = true;
CREATE INDEX idx_schedules_user ON public.schedules (user_id);

-- SCHEDULE RUNS table (history)
CREATE TABLE public.schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  post_id uuid,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success','failed','skipped')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Schedule runs select own" ON public.schedule_runs FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX idx_schedule_runs_schedule ON public.schedule_runs (schedule_id, created_at DESC);
CREATE INDEX idx_schedule_runs_user ON public.schedule_runs (user_id, created_at DESC);

-- POSTS additions
ALTER TABLE public.posts
  ADD COLUMN schedule_id uuid REFERENCES public.schedules(id) ON DELETE SET NULL,
  ADD COLUMN content_hash text;

CREATE INDEX idx_posts_schedule ON public.posts (schedule_id);
