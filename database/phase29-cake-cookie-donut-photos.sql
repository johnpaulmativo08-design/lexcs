-- Phase 29: fourth batch of real LexC product photos (requires phase 24).
-- New main photos for Bento Cake, Banana Loaf – Mini, the three Chunky Cookies and Mini Donuts – Premium Box,
-- plus a Bento Cake gallery. Each previous main photo moves to the end of its gallery, so no photo is lost.
-- Safe to re-run (sets fixed values).

update public.products p set
  image_path = g.main,
  gallery_image_paths = g.paths
from (values
  ('product-8', 'local:assets/products/bento-cake/main.webp',
    array['local:assets/products/bento-cake/1.webp','local:assets/products/bento-cake/2.webp','local:assets/products/bento-cake/3.webp','local:assets/products/bento-cake/4.webp','local:assets/products/bento-cake/5.webp','local:assets/products/bento-cake/6.webp','products/46b7a937-cd0f-400c-a9e2-2b84d2101290/5b6761d6-de83-4dca-8070-96452579bc63.jpg']),
  ('product-17', 'local:assets/products/banana-loaf-mini/main.webp',
    array['local:assets/products/banana-loaf-mini/1.webp','local:assets/products/banana-loaf-mini/2.webp','products/45b95503-d7d3-4757-b190-53fcc5903a08/978cc727-8b45-4215-8280-594d83441b41.jpg']),
  ('product-14', 'local:assets/products/chunky-cookies/main.webp',
    array['products/f03751b2-994e-4920-acdf-d22669f52bc2/f660098c-f5be-410a-8bd1-c2cf4a8cf41b.jpg']),
  ('product-15', 'local:assets/products/chunky-cookies/main.webp',
    array['products/30341edf-b258-45df-8f11-13995d74f180/d1a6d7ac-e616-4402-89e0-98ab59c47010.jpg']),
  ('product-16', 'local:assets/products/chunky-cookies/main.webp',
    array['products/215cd7ec-2d19-4de5-87fe-38cca48b62f4/f6944a1e-7431-40d0-bcbd-2ca37377318f.jpg']),
  ('product-1', 'local:assets/products/mini-donuts-premium/main.webp',
    array['products/85d27f00-fe3c-4043-9a96-39d35a67abb2/c68e0455-ec8c-4134-8668-a8c5607f7c86.jpg'])
) as g(slug, main, paths)
where p.slug = g.slug;
