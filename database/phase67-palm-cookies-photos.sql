-- Phase 67: Chunky Cookies – Palm Size gets its own photos (assets/products/chunky-cookies-palm). The new main photo
-- is the mixed box (dark chocolate, chocolate chip and oatmeal); the dark chocolate box goes in the gallery. The
-- previous main photo (shared with Chunky Cookies – Regular, which is unchanged) moves to the front of the gallery.
-- Safe to re-run.
begin;
update public.products p
set gallery_image_paths = array[p.image_path] || coalesce(p.gallery_image_paths, '{}'),
    image_path = 'local:assets/products/chunky-cookies-palm/main.webp'
where p.slug = 'product-16' and p.image_path is distinct from 'local:assets/products/chunky-cookies-palm/main.webp';
update public.products p
set gallery_image_paths = coalesce(p.gallery_image_paths, '{}') || array['local:assets/products/chunky-cookies-palm/gallery-1.webp']
where p.slug = 'product-16' and not ('local:assets/products/chunky-cookies-palm/gallery-1.webp' = any(coalesce(p.gallery_image_paths, '{}')));
commit;
