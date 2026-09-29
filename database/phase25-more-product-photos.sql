-- Phase 25: second batch of real LexC product photos (requires phase 24).
-- Replaces the main photo of Cupcake Bouquet, Brownies – Regular and Brownies Tower (owner's request)
-- and adds gallery photos. The previous main paths are shown by the final SELECT of the live run
-- (and stay in Storage), so they can be restored if needed. Safe to re-run.
-- Previous main photos on the hosted project (catalog-media storage, 2026-09-30):
--   product-7  Cupcake Bouquet       products/0f484070-06d1-42c0-86df-b18cd4116533/b7d5f25b-0fcb-473c-b5ca-aa1728e2bf68.jpg
--   product-20 Brownies – Regular    products/76e55da0-44a8-4156-a6e9-7a472900808c/4434f309-c8c5-4dda-863c-c67ea9e05963.jpg
--   product-21 Brownies Tower        products/26593d4b-8592-4314-b9c6-2cc9e12b4569/bec5ba43-3659-447a-bf9b-c3aafd1ef347.jpg

update public.products p set
  image_path = coalesce(g.main, p.image_path),
  gallery_image_paths = g.paths
from (values
  ('product-6',  null::text,                                        array['local:assets/products/3oz-cupcake/1.webp','local:assets/products/3oz-cupcake/2.webp']),
  ('product-7',  'local:assets/products/cupcake-bouquet/main.webp',  array['local:assets/products/cupcake-bouquet/1.webp']),
  ('product-19', null::text,                                        array['local:assets/products/brownies-bite-sized/1.webp','local:assets/products/brownies-bite-sized/2.webp']),
  ('product-20', 'local:assets/products/brownies-regular/main.webp', array['local:assets/products/brownies-regular/1.webp','local:assets/products/brownies-regular/2.webp']),
  ('product-21', 'local:assets/products/brownies-tower/main.webp',   '{}'::text[])
) as g(slug, main, paths)
where p.slug = g.slug;
