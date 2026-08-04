-- Multilingual support for recurring automations.
-- The code ('fr' | 'en' | 'es' | 'ar') is consumed by run-schedules when
-- building the text system prompt and the guarded image prompt.
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'fr';

COMMENT ON COLUMN public.schedules.language IS
  'Output language for generated posts and image typography (fr|en|es|ar).';
