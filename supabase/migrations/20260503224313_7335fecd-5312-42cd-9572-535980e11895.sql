
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS anthropic_api_key text,
  ADD COLUMN IF NOT EXISTS mistral_api_key text,
  ADD COLUMN IF NOT EXISTS groq_api_key text,
  ADD COLUMN IF NOT EXISTS deepseek_api_key text,
  ADD COLUMN IF NOT EXISTS xai_api_key text,
  ADD COLUMN IF NOT EXISTS perplexity_api_key text,
  ADD COLUMN IF NOT EXISTS openrouter_api_key text;
