-- Google retired the preview model identifiers in June 2026. New user
-- settings must use the stable Nano Banana 2 identifier; existing preview
-- values are mapped compatibly by the Edge Functions during generation.
ALTER TABLE public.user_settings
  ALTER COLUMN image_model SET DEFAULT 'google/gemini-3.1-flash-image';
