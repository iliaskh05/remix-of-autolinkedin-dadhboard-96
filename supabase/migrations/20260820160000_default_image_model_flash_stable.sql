-- Default image model: stable GA Gemini 2.5 Flash Image (Nano Banana).
-- Does not rewrite existing user choices for gemini-3-pro-image / 3.1-flash-image.

ALTER TABLE public.user_settings
  ALTER COLUMN image_model SET DEFAULT 'google/gemini-2.5-flash-image';
