-- Phase 66: more LexC's photos (files in assets/products/...).
--  * Gallery photos added after the existing ones: Choco Banana Muffin, Classic Banana Muffin, Bento Cake,
--    Themed Party Box, Cupcake Bouquet, Mini Donuts – Premium Box (2).
--  * New main photos: Yema Cake – Bento Size and Carrot Loaf – Loaded. Their previous main photo moves to the
--    front of the gallery, so nothing is lost. Carrot Loaf also gets a second (cropped) photo.
-- Safe to re-run: a photo already listed is not added again, and a main photo is only swapped once.
begin;

create temporary table photo_add(slug text, path text, n int) on commit drop;
insert into photo_add values
  ('product-10', 'local:assets/products/choco-banana-muffin/gallery-1.webp', 1),
  ('product-9',  'local:assets/products/classic-banana-muffin/gallery-3.webp', 1),
  ('product-8',  'local:assets/products/bento-cake/gallery-8.webp', 1),
  ('product-3',  'local:assets/products/mini-donuts-themed/gallery-7.webp', 1),
  ('product-7',  'local:assets/products/cupcake-bouquet/gallery-2.webp', 1),
  ('product-1',  'local:assets/products/mini-donuts-premium/gallery-8.webp', 1),
  ('product-1',  'local:assets/products/mini-donuts-premium/gallery-9.webp', 2);

-- new main photos (the old main goes first in the gallery)
update public.products p
set gallery_image_paths = array[p.image_path] || coalesce(p.gallery_image_paths, '{}'),
    image_path = m.path
from (values ('product-4', 'local:assets/products/yema-cake/main.webp'),
             ('product-13', 'local:assets/products/carrot-loaf/main.webp')) as m(slug, path)
where p.slug = m.slug and p.image_path is distinct from m.path;

insert into photo_add values ('product-13', 'local:assets/products/carrot-loaf/gallery-1.webp', 1);

update public.products p
set gallery_image_paths = coalesce(p.gallery_image_paths, '{}') || array(
  select a.path from photo_add a
  where a.slug = p.slug and not (a.path = any(coalesce(p.gallery_image_paths, '{}')))
  order by a.n)
where p.slug in (select slug from photo_add);

commit;
