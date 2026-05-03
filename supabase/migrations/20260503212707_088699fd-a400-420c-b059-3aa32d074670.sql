-- 1. profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by owner" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_settings (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- 2. user_settings (one row per user)
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- LinkedIn app (BYO)
  linkedin_client_id TEXT,
  linkedin_client_secret TEXT,
  -- LinkedIn connected account
  linkedin_access_token TEXT,
  linkedin_token_expires_at TIMESTAMPTZ,
  linkedin_person_urn TEXT,
  linkedin_organization_id TEXT,
  -- AI preferences
  post_model TEXT NOT NULL DEFAULT 'google/gemini-3-flash-preview',
  image_model TEXT NOT NULL DEFAULT 'google/gemini-3.1-flash-image-preview',
  -- BYOK (optional, override Lovable AI)
  use_byok BOOLEAN NOT NULL DEFAULT false,
  openai_api_key TEXT,
  gemini_api_key TEXT,
  -- Content tone / instructions
  tone_instructions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User settings select own" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User settings insert own" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User settings update own" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "User settings delete own" ON public.user_settings FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER trg_user_settings_updated BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. content_sources
CREATE TABLE public.content_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('url', 'keyword')),
  value TEXT NOT NULL,
  label TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_sources_user ON public.content_sources(user_id);
ALTER TABLE public.content_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Sources select own" ON public.content_sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Sources insert own" ON public.content_sources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Sources update own" ON public.content_sources FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Sources delete own" ON public.content_sources FOR DELETE USING (auth.uid() = user_id);

-- 4. posts: add user_id and scope RLS
ALTER TABLE public.posts ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_posts_user ON public.posts(user_id);

DROP POLICY IF EXISTS "Allow all access to posts" ON public.posts;
CREATE POLICY "Posts select own" ON public.posts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Posts insert own" ON public.posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Posts update own" ON public.posts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Posts delete own" ON public.posts FOR DELETE USING (auth.uid() = user_id);

-- 5. lock down legacy app_settings (no longer used by app, kept for safety)
DROP POLICY IF EXISTS "Allow all access to settings" ON public.app_settings;
CREATE POLICY "Service role only" ON public.app_settings FOR ALL USING (false) WITH CHECK (false);

-- 6. trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();