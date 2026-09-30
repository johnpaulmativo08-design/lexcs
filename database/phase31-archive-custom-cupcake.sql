-- Phase 31: the 3D cupcake designer was removed from the storefront, so its "Custom Cupcake"
-- product is archived (hidden from customers). Nothing is deleted: past orders, the recipe and reports
-- keep referring to it, and Admin > Products can make it Active again. Safe to re-run.
-- The code before the removal is kept on the GitHub branch backup/with-cake-maker.

update public.products set status = 'archived', updated_at = now()
where kind = 'customizable' and status = 'active'
returning slug, name, status;
