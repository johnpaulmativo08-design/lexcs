-- Phase 44: the owner's own photos for Chunky Cookies – Bite-Sized and both Crinkles products (files in
-- assets/products/chunky-cookies-bite-sized, crinkles-regular, crinkles-bite-sized). Only the photo fields change;
-- earlier photos stay in the gallery or in Storage, nothing is deleted. Safe to re-run.
begin;

update public.products set
  image_path = 'local:assets/products/chunky-cookies-bite-sized/main.webp',
  image_alt = 'Bite-sized chocolate chip cookies piled in a white box',
  gallery_image_paths = array['local:assets/products/chunky-cookies-bite-sized/1.webp', 'local:assets/products/chunky-cookies-bite-sized/2.webp']
    || array(select g from unnest(gallery_image_paths) g where g not like 'local:assets/products/chunky-cookies-bite-sized/%')
where slug = 'product-14';

update public.products set
  image_path = 'local:assets/products/crinkles-regular/main.webp',
  image_alt = 'A box of fifteen chocolate crinkles dusted with powdered sugar',
  gallery_image_paths = array['local:assets/products/crinkles-regular/1.webp', 'local:assets/products/crinkles-regular/2.webp']
where slug = 'product-23';

update public.products set
  image_path = 'local:assets/products/crinkles-bite-sized/main.webp',
  image_alt = 'Small tubs of chocolate crinkles dusted with powdered sugar',
  gallery_image_paths = array['local:assets/products/crinkles-bite-sized/1.webp', 'local:assets/products/crinkles-bite-sized/2.webp']
where slug = 'product-22';

do $$ begin
  if (select count(*) from public.products where slug in ('product-14', 'product-22', 'product-23') and image_path like 'local:assets/products/%') <> 3 then
    raise exception 'Phase 44: expected the three products to be updated.';
  end if;
end $$;

commit;
