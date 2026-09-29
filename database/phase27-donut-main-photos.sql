-- Phase 27: owner-chosen main photos for the two mini donut boxes (requires phase 24).
-- The chosen gallery photo becomes the main photo; the previous main photo moves into the gallery
-- in its place, so no photo is lost. Safe to re-run (sets fixed values).
--   product-2 Mini Donuts – Party Box         main was products/30d4669f-fa05-4eab-85d3-56511ffacd9e/cae3795d-d54b-448f-ae38-52e45931b0a8.jpg
--   product-3 Mini Donuts – Themed Party Box  main was products/4eb5de3c-9918-40e8-8d8d-7cad3a499768/069f174e-c10d-46f7-8578-30cf0c7dc5a4.jpg

update public.products p set
  image_path = g.main,
  gallery_image_paths = g.paths
from (values
  ('product-2', 'local:assets/products/mini-donuts-party/1.webp',
    array['products/30d4669f-fa05-4eab-85d3-56511ffacd9e/cae3795d-d54b-448f-ae38-52e45931b0a8.jpg','local:assets/products/mini-donuts-party/2.webp','local:assets/products/mini-donuts-party/3.webp']),
  ('product-3', 'local:assets/products/mini-donuts-themed/1.webp',
    array['products/4eb5de3c-9918-40e8-8d8d-7cad3a499768/069f174e-c10d-46f7-8578-30cf0c7dc5a4.jpg','local:assets/products/mini-donuts-themed/2.webp','local:assets/products/mini-donuts-themed/3.webp','local:assets/products/mini-donuts-themed/4.webp','local:assets/products/mini-donuts-themed/5.webp','local:assets/products/mini-donuts-themed/6.webp'])
) as g(slug, main, paths)
where p.slug = g.slug;
