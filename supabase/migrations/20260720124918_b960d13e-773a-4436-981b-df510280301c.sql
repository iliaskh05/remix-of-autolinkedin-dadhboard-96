-- Remove the SELECT policy that allowed listing post-assets objects
DROP POLICY IF EXISTS "Authenticated users can read post assets metadata" ON storage.objects;

-- Also drop the legacy public-read policies if they still exist for any reason
DROP POLICY IF EXISTS "Post assets read public" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for post assets" ON storage.objects;
