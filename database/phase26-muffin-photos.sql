-- Phase 26: third batch of real LexC product photos, the muffins (requires phase 24).
-- Replaces the main photo of all four muffin products and adds gallery photos. Safe to re-run.
-- Previous main photos on the hosted project (catalog-media storage, 2026-09-30), kept in Storage:
--   product-9  Classic Banana Muffin  products/ade1e1ad-574e-45ae-9e3b-c6fd7b163a31/ac497b04-28d3-4966-a0e9-11228b5b8f64.jpg
--   product-10 Choco Banana Muffin    products/796c1c96-3b7d-4aa6-9321-9aee586e4b87/5cfb8e42-1287-4bdd-a339-70ca065dc832.jpg
--   product-11 Carrot Muffin          products/f8e0a948-351c-482c-a30d-9db39afd135e/a84ed5c1-f341-4b42-b6db-27b8ab25dbba.jpg
--   product-12 Assorted Muffin Box    products/c6a275d0-1c65-435c-a3a4-6eccc7e6cc93/6b40c2a6-9ebb-4c66-b7b2-818c6f2e6cf2.jpg

update public.products p set
  image_path = coalesce(g.main, p.image_path),
  gallery_image_paths = g.paths
from (values
  ('product-9',  'local:assets/products/classic-banana-muffin/main.webp', array['local:assets/products/classic-banana-muffin/1.webp','local:assets/products/classic-banana-muffin/2.webp']),
  ('product-10', 'local:assets/products/choco-banana-muffin/main.webp',   '{}'::text[]),
  ('product-11', 'local:assets/products/carrot-muffin/main.webp',         array['local:assets/products/carrot-muffin/1.webp']),
  ('product-12', 'local:assets/products/assorted-muffin-box/main.webp',   array['local:assets/products/assorted-muffin-box/1.webp','local:assets/products/assorted-muffin-box/2.webp','local:assets/products/assorted-muffin-box/3.webp','local:assets/products/assorted-muffin-box/4.webp'])
) as g(slug, main, paths)
where p.slug = g.slug;
