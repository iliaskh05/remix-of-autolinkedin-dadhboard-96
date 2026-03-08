
-- Create storage bucket for post images
INSERT INTO storage.buckets (id, name, public) VALUES ('post-assets', 'post-assets', true);

CREATE POLICY "Public read access for post assets" ON storage.objects FOR SELECT USING (bucket_id = 'post-assets');
CREATE POLICY "Service role can upload post assets" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'post-assets');
