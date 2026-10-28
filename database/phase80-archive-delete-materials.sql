-- Phase 80 · Archive, restore and delete inventory materials (ingredients and packaging).
--
-- Why: the owner wants to retire materials she no longer uses, see a warning first when a material is still in a
-- recipe, and remove a retired material completely when it was never really used.
--
-- What it does (all admin only):
--   1. inventory_item_usage(material) — what still depends on it: the products whose ACTIVE recipe uses it, how many
--      other (draft / old) recipe versions list it, the stock still on hand, and how many batches, stock movements and
--      past order deductions mention it. The admin screens show this as a warning before archiving or deleting.
--   2. set_inventory_item_archived(material, archive) — archive or restore. Archiving uses the existing is_archived
--      flag, so the material disappears from restock lists and stock pages exactly like other archived materials.
--      Archiving is allowed even when a recipe still uses it (the screen warns first); its batches are not touched.
--   3. archived_inventory_items() — the archived materials with the same usage summary, for the Archive tab.
--   4. delete_inventory_item(material) — permanent delete, only for an ARCHIVED material that nothing points to:
--        no recipe lists it, no batch was ever stocked, no stock movement or past order deduction mentions it.
--      Stock history is never deleted (the movement ledger is append-only), so a material with any history stays
--      archived; the refusal says exactly why. Anything else that still points to it is caught too, and the material
--      is kept. Its aliases, unit conversions and alert records go with it.
--
-- What it does NOT do: change recipes, batches, movements, orders or any other material.
--
-- How to apply: rehearse with database/tests/phase80-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor.

create or replace function private.inventory_item_usage(target uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare itm public.inventory_items;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  select * into itm from public.inventory_items where id = target;
  if not found then raise exception 'Material not found.' using errcode = '22023'; end if;
  return jsonb_build_object(
    'id', itm.id, 'name', itm.name, 'unit', itm.unit, 'category', itm.category, 'inventory_type', itm.inventory_type,
    'is_archived', itm.is_archived,
    'active_recipes', (select coalesce(jsonb_agg(distinct coalesce(p.name, r.name)), '[]'::jsonb)
                         from public.recipe_lines l join public.product_recipes r on r.id = l.recipe_id
                         left join public.products p on p.id = r.product_id
                        where l.item_id = itm.id and r.status = 'active'),
    'other_recipes', (select count(distinct r.id) from public.recipe_lines l join public.product_recipes r on r.id = l.recipe_id
                       where l.item_id = itm.id and r.status <> 'active'),
    'stock', (select coalesce(sum(m.quantity_delta), 0) from public.inventory_movements m join public.inventory_batches b on b.id = m.batch_id
               where b.item_id = itm.id and b.archived_at is null),
    'batches', (select count(*) from public.inventory_batches where item_id = itm.id),
    'movements', (select count(*) from public.inventory_movements m
                   where m.item_id = itm.id or m.batch_id in (select b.id from public.inventory_batches b where b.item_id = itm.id)),
    'order_uses', (select count(*) from public.order_inventory_allocation_lines where item_id = itm.id));
end $$;

create or replace function private.set_inventory_item_archived(target uuid, archive boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  if archive is null then raise exception 'Choose archive or restore.' using errcode = '22023'; end if;
  update public.inventory_items set is_archived = archive, updated_at = now() where id = target;
  if not found then raise exception 'Material not found.' using errcode = '22023'; end if;
  return private.inventory_item_usage(target);
end $$;

create or replace function private.archived_inventory_items()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(private.inventory_item_usage(i.id) order by i.name), '[]'::jsonb)
            from public.inventory_items i where i.is_archived);
end $$;

create or replace function private.delete_inventory_item(target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare itm public.inventory_items; u jsonb; why text[] := '{}'; n int;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  select * into itm from public.inventory_items where id = target for update;
  if not found then raise exception 'Material not found. It may already be deleted.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lexc-inventory-item:' || itm.id::text, 0));
  if not itm.is_archived then raise exception 'Archive % first, then delete it from the archive.', itm.name using errcode = '22023'; end if;
  u := private.inventory_item_usage(target);
  if jsonb_array_length(u->'active_recipes') > 0 then
    why := why || ('it is in the active recipe of ' || (select string_agg(x, ', ') from jsonb_array_elements_text(u->'active_recipes') x));
  end if;
  select count(*) into n from public.recipe_lines where item_id = itm.id;
  if n > 0 and jsonb_array_length(u->'active_recipes') = 0 then why := why || ('it is still listed in ' || n || ' recipe line(s) of draft or older recipe versions'); end if;
  if (u->>'batches')::int > 0 then why := why || ('it has ' || (u->>'batches') || ' stock batch(es) whose history must be kept'); end if;
  if (u->>'order_uses')::int > 0 then why := why || ('past orders used it ' || (u->>'order_uses') || ' time(s)'); end if;
  if (u->>'movements')::int > 0 and (u->>'batches')::int = 0 then why := why || ('it has ' || (u->>'movements') || ' stock movement(s) in History'); end if;
  if cardinality(why) > 0 then
    raise exception '% can''t be deleted: %. It stays archived, so it is hidden everywhere and past records stay correct.', itm.name, array_to_string(why, '; ') using errcode = '22023';
  end if;
  begin
    delete from public.inventory_items where id = itm.id;
  exception when foreign_key_violation then
    raise exception '% can''t be deleted because other records still point to it. It stays archived.', itm.name using errcode = '22023';
  end;
  return jsonb_build_object('deleted', true, 'id', itm.id, 'name', itm.name);
end $$;

revoke all on function private.inventory_item_usage(uuid) from public;
revoke all on function private.set_inventory_item_archived(uuid, boolean) from public;
revoke all on function private.archived_inventory_items() from public;
revoke all on function private.delete_inventory_item(uuid) from public;
grant execute on function private.inventory_item_usage(uuid) to authenticated;
grant execute on function private.set_inventory_item_archived(uuid, boolean) to authenticated;
grant execute on function private.archived_inventory_items() to authenticated;
grant execute on function private.delete_inventory_item(uuid) to authenticated;

create or replace function public.inventory_item_usage(target uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.inventory_item_usage(target) $$;
create or replace function public.set_inventory_item_archived(target uuid, archive boolean) returns jsonb language sql security invoker set search_path = '' as $$ select private.set_inventory_item_archived(target, archive) $$;
create or replace function public.archived_inventory_items() returns jsonb language sql security invoker set search_path = '' as $$ select private.archived_inventory_items() $$;
create or replace function public.delete_inventory_item(target uuid) returns jsonb language sql security invoker set search_path = '' as $$ select private.delete_inventory_item(target) $$;
revoke all on function public.inventory_item_usage(uuid) from public;
revoke all on function public.set_inventory_item_archived(uuid, boolean) from public;
revoke all on function public.archived_inventory_items() from public;
revoke all on function public.delete_inventory_item(uuid) from public;
grant execute on function public.inventory_item_usage(uuid) to authenticated;
grant execute on function public.set_inventory_item_archived(uuid, boolean) to authenticated;
grant execute on function public.archived_inventory_items() to authenticated;
grant execute on function public.delete_inventory_item(uuid) to authenticated;

notify pgrst, 'reload schema';
