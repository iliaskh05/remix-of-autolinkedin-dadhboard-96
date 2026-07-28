-- Phase 1 (AI text) — configurable generation defaults per user.
-- These are the user's default tone / target audience / length used to build
-- the system prompt of the text generation function. They can be overridden
-- per generation from the Composer.

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS post_tone TEXT;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS post_audience TEXT;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS post_length TEXT;
