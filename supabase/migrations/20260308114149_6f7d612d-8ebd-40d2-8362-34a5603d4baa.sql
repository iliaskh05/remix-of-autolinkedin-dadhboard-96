
DROP POLICY IF EXISTS "Allow all access to settings" ON public.app_settings;
CREATE POLICY "Allow all access to settings"
  ON public.app_settings
  FOR ALL
  USING (true)
  WITH CHECK (true);
