-- Phase 49: correct a stock batch that was entered wrongly (Inventory → material → Active batches → Edit).
-- Editable: quantity received, stock-in date, expiry date, purchase price. The batch code never changes.
-- Inventory history stays exact: movements are permanent, so a quantity correction is recorded as a new
-- adjustment movement for the difference ("Batch correction APF-005: 5 kg → 6 kg (+1 kg)"), which updates the
-- batch remainder, the item total and the ledger together. Date/price-only corrections add no movement; they are
-- written to the batch notes with the date and reason. Safe to re-run.
-- Also: inventory_item_detail returns each recipe's product_id (unchanged otherwise).
begin;

create or replace function public.correct_inventory_batch(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  u uuid := private.require_admin();
  req uuid := nullif(payload->>'request_id','')::uuid;
  why text := btrim(coalesce(payload->>'reason',''));
  b public.inventory_batches; itm public.inventory_items;
  today date := (now() at time zone 'Asia/Manila')::date;
  new_in date; new_exp date; new_price numeric(12,2); new_qty numeric(14,3); diff numeric(14,3); remaining numeric(14,3);
  changes text[] := '{}';
  fmt_date constant text := 'Mon DD, YYYY';
begin
  if req is null then raise exception 'Request ID is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('lexc-batch-correction:' || req::text, 0));
  if exists (select 1 from public.inventory_movements where request_id = req) then return jsonb_build_object('duplicate', true); end if;

  select * into b from public.inventory_batches where id = nullif(payload->>'batch_id','')::uuid for update;
  if b.id is null then raise exception 'Batch not found.' using errcode = '22023'; end if;
  if b.archived_at is not null then raise exception 'This batch is archived and can no longer be corrected.' using errcode = '22023'; end if;
  select * into itm from public.inventory_items where id = b.item_id;
  perform pg_advisory_xact_lock(hashtextextended('lexc-inventory-item:' || itm.id::text, 0));
  if length(why) < 3 then raise exception 'Write why you are correcting this batch.' using errcode = '22023'; end if;

  -- dates
  new_in := coalesce(nullif(payload->>'stock_in_date','')::date, b.stock_in_date);
  if new_in > today then raise exception 'The stock-in date cannot be in the future.' using errcode = '22023'; end if;
  new_exp := case when payload ? 'expires_on' then nullif(payload->>'expires_on','')::date else b.expires_on end;
  if new_exp is not null and new_exp < new_in then raise exception 'The expiry date cannot be before the stock-in date.' using errcode = '22023'; end if;
  if new_exp is not null and new_exp < today and new_exp is distinct from b.expires_on then
    raise exception 'That expiry date has already passed. To write off expired stock, use Adjust stock → Expiry write-off.' using errcode = '22023';
  end if;

  -- price
  new_price := case when payload ? 'purchase_price' then nullif(payload->>'purchase_price','')::numeric else b.purchase_price end;
  if new_price is not null and new_price < 0 then raise exception 'The purchase price cannot be negative.' using errcode = '22023'; end if;

  -- quantity received → one adjustment movement for the difference
  new_qty := round(coalesce(nullif(payload->>'quantity_received','')::numeric, b.quantity_received), 3);
  if new_qty < 0 then raise exception 'The quantity cannot be negative.' using errcode = '22023'; end if;
  diff := new_qty - b.quantity_received;
  select coalesce(sum(quantity_delta), 0) into remaining from public.inventory_movements where batch_id = b.id;
  if remaining + diff < 0 then
    raise exception 'Cannot lower it to % %: % % of this batch has already been used.', new_qty, itm.unit, b.quantity_received - remaining, itm.unit using errcode = '22023';
  end if;
  if diff <> 0 then
    insert into public.inventory_movements(batch_id, quantity_delta, reason, movement_type, note, reference, created_by, request_id, actor_kind)
    values (b.id, diff, 'adjustment', case when diff > 0 then 'adjustment_positive' else 'adjustment_negative' end,
      left('Batch correction ' || b.batch_code || ': ' || trim_scale(b.quantity_received) || ' ' || itm.unit || ' → ' || trim_scale(new_qty) || ' ' || itm.unit
        || ' (' || case when diff > 0 then '+' else '' end || trim_scale(diff) || ' ' || itm.unit || '). ' || why, 500),
      'batch_correction', u, req, 'admin');
    changes := changes || ('quantity ' || trim_scale(b.quantity_received) || ' → ' || trim_scale(new_qty) || ' ' || itm.unit);
  end if;
  if new_in is distinct from b.stock_in_date then changes := changes || ('stock-in ' || to_char(b.stock_in_date, fmt_date) || ' → ' || to_char(new_in, fmt_date)); end if;
  if new_exp is distinct from b.expires_on then changes := changes || ('expiry ' || coalesce(to_char(b.expires_on, fmt_date), 'none') || ' → ' || coalesce(to_char(new_exp, fmt_date), 'none')); end if;
  if new_price is distinct from b.purchase_price then changes := changes || ('price ' || coalesce('₱' || b.purchase_price::text, 'none') || ' → ' || coalesce('₱' || new_price::text, 'none')); end if;
  if array_length(changes, 1) is null then raise exception 'Nothing changed.' using errcode = '22023'; end if;

  update public.inventory_batches set
    quantity_received = new_qty, stock_in_date = new_in, expires_on = new_exp, purchase_price = new_price,
    notes = btrim(coalesce(notes, '') || E'\n' || '[' || to_char(today, fmt_date) || '] Corrected ' || array_to_string(changes, '; ') || ' — ' || why)
  where id = b.id;
  perform private.sync_inventory_alerts();
  return jsonb_build_object('batch_id', b.id, 'changes', to_jsonb(changes), 'difference', diff,
    'remaining', remaining + diff, 'available', private.item_available(itm.id));
end $$;
revoke all on function public.correct_inventory_batch(jsonb) from public, anon;
grant execute on function public.correct_inventory_batch(jsonb) to authenticated;

-- The material drawer's "Used in recipes" chips now open the product that owns the recipe (recipes live in Products).
create or replace function public.inventory_item_detail(target_item uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_admin();
  if not exists (select 1 from public.inventory_items where id = target_item) then raise exception 'Inventory item not found.'; end if;
  return jsonb_build_object(
    'item', (select to_jsonb(s) from public.inventory_item_stock s where s.id = target_item),
    'aliases', (select coalesce(jsonb_agg(alias order by alias), '[]') from public.inventory_item_aliases where item_id = target_item),
    'conversions', (select coalesce(jsonb_agg(to_jsonb(c) order by c.unit), '[]') from public.inventory_unit_conversions c where c.item_id = target_item),
    'batches', (select coalesce(jsonb_agg(to_jsonb(b) order by b.expires_on nulls last, b.received_at), '[]') from public.inventory_batch_stock b where b.item_id = target_item and b.archived_at is null),
    'movements', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]') from (
      select jsonb_build_object('id', m.id, 'created_at', m.created_at, 'movement_type', m.movement_type, 'quantity_delta', m.quantity_delta,
        'stock_before', m.stock_before, 'stock_after', m.stock_after, 'batch_code', b.batch_code, 'note', m.note, 'reference', m.reference,
        'order_id', m.order_id, 'order_number', o.order_number, 'actor_name', coalesce(nullif(p.full_name,''), 'System'), 'actor_kind', m.actor_kind) as x
      from public.inventory_movements m join public.inventory_batches b on b.id = m.batch_id left join public.orders o on o.id = m.order_id
      left join public.profiles p on p.id = m.created_by
      where m.item_id = target_item order by m.created_at desc limit 25) r),
    'recipes', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', r.id, 'name', r.name, 'version', r.version, 'status', r.status, 'product_id', r.product_id)), '[]')
      from public.recipe_lines l join public.product_recipes r on r.id = l.recipe_id where l.item_id = target_item and r.status in ('active','draft'))
  );
end $$;
revoke all on function public.inventory_item_detail(uuid) from public, anon;
grant execute on function public.inventory_item_detail(uuid) to authenticated;
commit;
