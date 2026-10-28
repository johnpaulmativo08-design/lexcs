-- Phase 80 rehearsal · tests archiving, restoring and deleting materials on the real database WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 80, then as the admin: archives a material
-- that an active recipe uses (allowed, with the recipe named), tries to delete it (refused, recipe named), restores it;
-- makes a pretend unused material, tries to delete it before archiving (refused), archives and deletes it (allowed);
-- and checks a customer cannot use any of it. It ends with an error on purpose: that cancels the whole transaction.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 80 =====
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


do $rehearsal$
declare
  admin_id uuid; customer_id uuid; used_id uuid; spare_id uuid; u jsonb; report text := ''; ok boolean; n int; as_admin text; as_customer text;
begin
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' limit 1;
  select u2.id into customer_id from auth.users u2 left join public.user_roles r on r.user_id = u2.id where coalesce(r.role, 'customer') = 'customer' order by u2.created_at limit 1;
  as_admin := json_build_object('sub', admin_id, 'role', 'authenticated')::text;
  as_customer := json_build_object('sub', customer_id, 'role', 'authenticated')::text;
  select l.item_id into used_id from public.recipe_lines l join public.product_recipes r on r.id = l.recipe_id join public.inventory_items i on i.id = l.item_id
   where r.status = 'active' and not i.is_archived limit 1;

  perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  -- a material in an active recipe
  u := public.inventory_item_usage(used_id);
  report := report || E'\nINFO  ' || (u->>'name') || ': active recipes ' || (u->'active_recipes')::text || ', batches ' || (u->>'batches') || ', movements ' || (u->>'movements') || ', order uses ' || (u->>'order_uses');
  ok := jsonb_array_length(u->'active_recipes') > 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  usage names the products whose recipe uses it';
  u := public.set_inventory_item_archived(used_id, true);
  ok := (u->>'is_archived')::boolean and exists (select 1 from jsonb_array_elements(public.archived_inventory_items()) x where x->>'id' = used_id::text);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  archived, and listed in the archive';
  begin perform public.delete_inventory_item(used_id); report := report || E'\nFAIL  a material in an active recipe was deleted';
  exception when others then report := report || E'\nPASS  delete refused: ' || sqlerrm; end;
  u := public.set_inventory_item_archived(used_id, false);
  report := report || E'\n' || case when not (u->>'is_archived')::boolean then 'PASS' else 'FAIL' end || '  restored';

  -- a brand-new material nothing uses
  perform set_config('role', 'postgres', true);
  spare_id := gen_random_uuid();
  insert into public.inventory_items
    select (jsonb_populate_record(null::public.inventory_items, to_jsonb(i) || jsonb_build_object('id', spare_id, 'name', 'Rehearsal material ' || left(spare_id::text, 6),
      'code', 'RH' || upper(left(replace(spare_id::text, '-', ''), 6)), 'item_code', 'RH' || upper(left(replace(spare_id::text, '-', ''), 6)), 'is_archived', false))).*
    from public.inventory_items i limit 1;
  perform set_config('role', 'authenticated', true);
  begin perform public.delete_inventory_item(spare_id); report := report || E'\nFAIL  deleted without archiving first';
  exception when others then report := report || E'\nPASS  must archive first: ' || sqlerrm; end;
  perform public.set_inventory_item_archived(spare_id, true);
  begin
    u := public.delete_inventory_item(spare_id);
    perform set_config('role', 'postgres', true);
    select count(*) into n from public.inventory_items where id = spare_id;
    report := report || E'\n' || case when (u->>'deleted')::boolean and n = 0 then 'PASS' else 'FAIL' end || '  unused archived material deleted';
  exception when others then perform set_config('role', 'postgres', true); report := report || E'\nFAIL  unused archived material not deleted: ' || sqlerrm; end;

  -- a material with stock history but no recipe (if there is one)
  select i.id into spare_id from public.inventory_items i where exists (select 1 from public.inventory_batches b where b.item_id = i.id)
     and not exists (select 1 from public.recipe_lines l where l.item_id = i.id) limit 1;
  if spare_id is null then report := report || E'\nSKIP  no material with history outside recipes';
  else
    perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
    perform public.set_inventory_item_archived(spare_id, true);
    begin perform public.delete_inventory_item(spare_id); report := report || E'\nFAIL  material with stock history was deleted';
    exception when others then report := report || E'\nPASS  history kept: ' || sqlerrm; end;
    perform set_config('role', 'postgres', true);
  end if;

  -- customers can't
  perform set_config('request.jwt.claims', as_customer, true); perform set_config('role', 'authenticated', true);
  begin perform public.set_inventory_item_archived(used_id, true); report := report || E'\nFAIL  customer archived a material';
  exception when others then report := report || E'\nPASS  customer refused: ' || sqlerrm; end;
  begin perform public.delete_inventory_item(used_id); report := report || E'\nFAIL  customer reached delete';
  exception when others then report := report || E'\nPASS  customer delete refused'; end;
  perform set_config('role', 'postgres', true);

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
