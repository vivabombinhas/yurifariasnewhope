
CREATE POLICY "auth read product-photos" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'product-photos');
CREATE POLICY "auth insert product-photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-photos');
CREATE POLICY "auth update product-photos" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'product-photos') WITH CHECK (bucket_id = 'product-photos');
CREATE POLICY "auth delete product-photos" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'product-photos');
