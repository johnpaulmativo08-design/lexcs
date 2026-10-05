-- Phase 45: the owner's own photos for Brownies – Bite-Sized (new main photo) and Banana Loaf – Mini (sharper copy
-- of the same main photo, same file path). Only the photo fields change; the earlier main photo stays in the gallery.
-- Safe to re-run.
begin;
update public.products set
  gallery_image_paths = case when image_path like 'local:assets/products/brownies-bite-sized/%' then gallery_image_paths
                             else array[image_path] || array(select g from unnest(gallery_image_paths) g where g <> image_path) end,
  image_path = 'local:assets/products/brownies-bite-sized/main.webp',
  image_alt = 'A hand holding a white box of bite-sized fudgy brownies topped with chopped nuts'
where slug = 'product-19';
update public.products set
  image_alt = 'Round mini banana loaves topped with walnuts and chocolate chips, each in its own white box'
where slug = 'product-17' and image_path = 'local:assets/products/banana-loaf-mini/main.webp';
do $$ begin
  if (select count(*) from public.products where slug = 'product-19' and image_path = 'local:assets/products/brownies-bite-sized/main.webp') <> 1
  then raise exception 'Phase 45: Brownies – Bite-Sized was not updated'; end if;
end $$;
commit;
