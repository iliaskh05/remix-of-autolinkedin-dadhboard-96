-- 1. Prevent direct execution of SECURITY DEFINER trigger function by app roles
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 2. Remove GraphQL schema access for anon and authenticated (app uses REST/PostgREST)
REVOKE USAGE ON SCHEMA graphql FROM anon, authenticated;

-- 3. Remove anonymous SELECT on all existing public tables so they don't appear in GraphQL
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;

-- 4. Ensure future tables also don't get anonymous SELECT by default
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;

-- 5. Restrict post-assets storage SELECT policies to authenticated users only (prevent anon listing)
-- Drop the existing public SELECT policies and recreate them for authenticated only.
DROP POLICY IF EXISTS "Post assets read public" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for post assets" ON storage.objects;

CREATE POLICY "Authenticated users can read post assets metadata"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'post-assets');
