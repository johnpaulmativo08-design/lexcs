-- Phase 28: owner-chosen main photos for Mini Cupcakes, 3oz Cupcake and Banana Loaf – Classic (requires phase 24).
-- The chosen gallery photo becomes the main photo; the previous main photo takes its place in the gallery,
-- so no photo is lost. Safe to re-run (sets fixed values).

update public.products p set
  image_path = g.main,
  gallery_image_paths = g.paths
from (values
  ('product-5', 'local:assets/products/mini-cupcakes/3.webp',
    array['local:assets/products/mini-cupcakes/1.webp','local:assets/products/mini-cupcakes/2.webp','products/e158100a-7231-410d-8320-fb016c58e89b/98e2047a-2519-4b64-82e7-9e91ecb99fac.jpg']),
  ('product-6', 'local:assets/products/3oz-cupcake/2.webp',
    array['local:assets/products/3oz-cupcake/1.webp','products/68b54c35-dcb3-4398-bb76-14384b06ec4e/6b2efd4f-5b2d-4da5-8e78-9be708439be3.jpg']),
  ('product-18', 'local:assets/products/banana-loaf-classic/1.webp',
    array['products/936a7441-6883-41f7-a151-a07567a8a44f/6d6c184c-aa08-4ae4-bcd1-8a1464fad8a9.jpg','local:assets/products/banana-loaf-classic/2.webp','local:assets/products/banana-loaf-classic/3.webp','local:assets/products/banana-loaf-classic/4.webp'])
) as g(slug, main, paths)
where p.slug = g.slug;
