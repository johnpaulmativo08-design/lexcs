-- Phase 24: extra photos per product for the storefront Product Detail gallery.
-- products.image_path stays the main/card photo; gallery_image_paths are shown after it.
-- Paths use the same format as image_path ("local:<site path>" or a catalog-media storage path).
-- Safe to re-run: the column is added once and the photo lists are simply re-set.

alter table public.products
  add column if not exists gallery_image_paths text[] not null default '{}'::text[];

alter table public.products drop constraint if exists products_gallery_image_paths_limit;
alter table public.products add constraint products_gallery_image_paths_limit
  check (cardinality(gallery_image_paths) <= 12);

-- Real LexC product photos (assets/products/<slug>/), supplied by the owner.
update public.products p set gallery_image_paths = g.paths
from (values
  ('product-5',  array['local:assets/products/mini-cupcakes/1.webp','local:assets/products/mini-cupcakes/2.webp','local:assets/products/mini-cupcakes/3.webp']),
  ('product-2',  array['local:assets/products/mini-donuts-party/1.webp','local:assets/products/mini-donuts-party/2.webp','local:assets/products/mini-donuts-party/3.webp']),
  ('product-18', array['local:assets/products/banana-loaf-classic/1.webp','local:assets/products/banana-loaf-classic/2.webp','local:assets/products/banana-loaf-classic/3.webp','local:assets/products/banana-loaf-classic/4.webp']),
  ('product-17', array['local:assets/products/banana-loaf-mini/1.webp','local:assets/products/banana-loaf-mini/2.webp']),
  ('product-3',  array['local:assets/products/mini-donuts-themed/1.webp','local:assets/products/mini-donuts-themed/2.webp','local:assets/products/mini-donuts-themed/3.webp','local:assets/products/mini-donuts-themed/4.webp','local:assets/products/mini-donuts-themed/5.webp','local:assets/products/mini-donuts-themed/6.webp'])
) as g(slug, paths)
where p.slug = g.slug;
