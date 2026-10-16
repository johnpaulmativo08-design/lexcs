-- Phase 64: seven more LexC's photos in the Mini Donuts – Premium Box gallery (files in assets/products/mini-donuts-premium).
-- They are added after the photos already there; the main photo is unchanged. Safe to re-run (a photo already listed is not added again).
begin;
update public.products p
set gallery_image_paths = coalesce(p.gallery_image_paths, '{}') || array(
  select path from unnest(array[
    'local:assets/products/mini-donuts-premium/gallery-1.webp',
    'local:assets/products/mini-donuts-premium/gallery-2.webp',
    'local:assets/products/mini-donuts-premium/gallery-3.webp',
    'local:assets/products/mini-donuts-premium/gallery-4.webp',
    'local:assets/products/mini-donuts-premium/gallery-5.webp',
    'local:assets/products/mini-donuts-premium/gallery-6.webp',
    'local:assets/products/mini-donuts-premium/gallery-7.webp'
  ]) with ordinality as t(path, n)
  where not (path = any(coalesce(p.gallery_image_paths, '{}')))
  order by n)
where p.slug = 'product-1';
commit;
