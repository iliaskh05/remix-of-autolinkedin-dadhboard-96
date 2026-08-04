-- Nano Banana Pro (Gemini 3 Pro Image) becomes the default image model.
ALTER TABLE public.user_settings
  ALTER COLUMN image_model SET DEFAULT 'google/gemini-3-pro-image';

-- Move settings that still hold an automatically-assigned Flash default.
-- An explicit 'google/gemini-2.5-flash-image' choice is left untouched.
UPDATE public.user_settings
SET image_model = 'google/gemini-3-pro-image'
WHERE image_model IN (
  'google/gemini-3.1-flash-image',
  'google/gemini-3.1-flash-image-preview',
  'google/gemini-3-pro-image-preview'
);
