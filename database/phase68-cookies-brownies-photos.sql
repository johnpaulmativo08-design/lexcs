-- Phase 68: Chunky Cookies – Regular gets two gallery photos (assets/products/chunky-cookies-regular).
-- Brownies – Bite-Sized gets a new main photo (brownies and blondies tub, main-2.webp) and a gallery photo; its
-- previous main photo moves to the front of the gallery. Safe to re-run.
begin;
update public.products p
set gallery_image_paths = array[p.image_path] || coalesce(p.gallery_image_paths, '{}'),
    image_path = 'local:assets/products/brownies-bite-sized/main-2.webp'
where p.slug = 'product-19' and p.image_path is distinct from 'local:assets/products/brownies-bite-sized/main-2.webp';

update public.products p
set gallery_image_paths = coalesce(p.gallery_image_paths, '{}') || array(
  select a.path from (values
    ('product-15', 'local:assets/products/chunky-cookies-regular/gallery-1.webp', 1),
    ('product-15', 'local:assets/products/chunky-cookies-regular/gallery-2.webp', 2),
    ('product-19', 'local:assets/products/brownies-bite-sized/gallery-3.webp', 1)) as a(slug, path, n)
  where a.slug = p.slug and not (a.path = any(coalesce(p.gallery_image_paths, '{}')))
  order by a.n)
where p.slug in ('product-15', 'product-19');
commit;
