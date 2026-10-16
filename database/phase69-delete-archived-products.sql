-- Phase 69: permanently remove an archived product (Admin → Products → "Remove permanently").
-- Only for a product that is archived and was never ordered or used in stock. Removes its options, designer
-- options, recipes (with their lines and per-option amounts, which hold its ingredient costs) and the product.
-- Sweet moments posts that showed it are kept, just no longer linked. Anything with order or stock history is
-- refused: archive keeps that history. Then removes Lava Crinkles, Caramel Bar and Chunky Cookies – Regular.
begin;

create or replace function private.delete_archived_product(p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.products;
begin
  if not private.is_admin() then raise exception 'Only LexC''s can remove products.' using errcode = '42501'; end if;
  select * into p from public.products where id = p_product for update;
  if p.id is null then raise exception 'This product no longer exists.' using errcode = '22023'; end if;
  if p.status <> 'archived' then raise exception 'Archive the product first, then remove it.' using errcode = '22023'; end if;
  if exists (select 1 from public.order_items where product_id = p.id) then
    raise exception 'This product has orders, so it stays archived to keep the order history.' using errcode = '22023'; end if;
  if exists (select 1 from public.inventory_movements m join public.product_recipes r on r.id = m.recipe_id where r.product_id = p.id)
     or exists (select 1 from public.order_inventory_allocation_lines a join public.product_recipes r on r.id = a.recipe_id where r.product_id = p.id) then
    raise exception 'This product has stock history, so it stays archived.' using errcode = '22023'; end if;

  update public.store_posts set product_id = null where product_id = p.id;
  delete from public.recipe_variant_units where recipe_id in (select id from public.product_recipes where product_id = p.id)
    or variant_id in (select id from public.product_variants where product_id = p.id);
  delete from public.recipe_lines where recipe_id in (select id from public.product_recipes where product_id = p.id);
  delete from public.inventory_variant_recipes where variant_id in (select id from public.product_variants where product_id = p.id);
  delete from public.product_recipes where product_id = p.id;
  delete from public.design_options where product_id = p.id;
  delete from public.product_variants where product_id = p.id;
  delete from public.products where id = p.id;
end $$;
revoke all on function private.delete_archived_product(uuid) from public;

create or replace function public.delete_archived_product(p_product uuid) returns void
language sql security invoker set search_path = '' as $$ select private.delete_archived_product(p_product) $$;
revoke all on function public.delete_archived_product(uuid) from public;
grant execute on function public.delete_archived_product(uuid) to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.delete_archived_product(uuid) to authenticated;

-- the three products asked to be removed (run as the database owner, so the admin check is skipped here)
do $$
declare pid uuid;
begin
  for pid in select id from public.products where slug in ('product-24', 'product-25', 'product-15') loop
    update public.products set status = 'archived' where id = pid;
    update public.store_posts set product_id = null where product_id = pid;
    delete from public.recipe_variant_units where recipe_id in (select id from public.product_recipes where product_id = pid)
      or variant_id in (select id from public.product_variants where product_id = pid);
    delete from public.recipe_lines where recipe_id in (select id from public.product_recipes where product_id = pid);
    delete from public.inventory_variant_recipes where variant_id in (select id from public.product_variants where product_id = pid);
    delete from public.product_recipes where product_id = pid;
    delete from public.design_options where product_id = pid;
    delete from public.product_variants where product_id = pid;
    delete from public.products where id = pid;
  end loop;
end $$;
commit;
