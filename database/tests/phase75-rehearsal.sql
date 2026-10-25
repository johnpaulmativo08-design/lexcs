-- Phase 75 rehearsal · tests size discounts on the real database WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 75, then (as the admin) saves discounts on
-- one size and checks today's price for percent, peso, future and past discounts and the refused values; then (as a
-- customer) places a pretend pickup order of 2 of that size and checks the order was priced with the discount.
-- It ends with an error on purpose: that cancels the whole transaction, so nothing is saved — not the columns, not the
-- discount, not the pretend order.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- 1. Columns ---------------------------------------------------------------------------------------------------
alter table public.product_variants add column if not exists discount_type text;
alter table public.product_variants add column if not exists discount_value numeric(12,2);
alter table public.product_variants add column if not exists discount_starts date;
alter table public.product_variants add column if not exists discount_ends date;
alter table public.product_variants drop constraint if exists product_variants_discount_shape;
alter table public.product_variants add constraint product_variants_discount_shape check (
  (discount_type is null and discount_value is null and discount_starts is null and discount_ends is null)
  or (discount_type = 'percent' and discount_value between 1 and 95)
  or (discount_type = 'amount' and discount_value > 0));
alter table public.product_variants drop constraint if exists product_variants_discount_dates;
alter table public.product_variants add constraint product_variants_discount_dates
  check (discount_starts is null or discount_ends is null or discount_ends >= discount_starts);

-- 2. Today's selling price of a size ------------------------------------------------------------------------------
create or replace function private.variant_price_now(v public.product_variants) returns numeric
language sql stable set search_path = '' as $$
  select case
    when v.discount_type is null or v.discount_value is null then v.price
    when v.discount_starts is not null and (now() at time zone 'Asia/Manila')::date < v.discount_starts then v.price
    when v.discount_ends is not null and (now() at time zone 'Asia/Manila')::date > v.discount_ends then v.price
    when v.discount_type = 'percent' then round(v.price * (100 - v.discount_value) / 100, 2)
    when v.discount_type = 'amount' and v.discount_value < v.price then round(v.price - v.discount_value, 2)
    else v.price
  end
$$;
revoke all on function private.variant_price_now(public.product_variants) from public;

-- 3. Checkout charges today's price ------------------------------------------------------------------------------
do $$
declare def text; a text := 'subtotal:=subtotal+variant.price*qty;'; b text := '''price'',variant.price,';
begin
  def := pg_get_functiondef('private.checkout(jsonb)'::regprocedure);
  if position('variant_price_now' in def) > 0 then raise notice 'checkout already uses variant_price_now'; return; end if;
  if (length(def) - length(replace(def, a, ''))) / length(a) <> 1 or (length(def) - length(replace(def, b, ''))) / length(b) <> 1 then
    raise exception 'private.checkout is not the expected version; review before applying phase 75.';
  end if;
  def := replace(def, a, 'subtotal:=subtotal+private.variant_price_now(variant)*qty;');
  def := replace(def, b, '''price'',private.variant_price_now(variant),');
  execute def;
end $$;

-- 4. Owner saves the discounts of a product's sizes --------------------------------------------------------------
create or replace function private.save_variant_discounts(target_product uuid, items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare it jsonb; v public.product_variants; kind text; val numeric; starts date; ends date;
begin
  perform private.require_admin();
  if jsonb_typeof(items) is distinct from 'array' then raise exception 'Discounts must be a list.'; end if;
  for it in select value from jsonb_array_elements(items) loop
    select * into v from public.product_variants where id = (it->>'variant_id')::uuid and product_id = target_product for update;
    if not found then raise exception 'A size in the discount list does not belong to this product.'; end if;
    kind := nullif(it->>'type', '');
    if kind is null or kind = 'none' then
      update public.product_variants set discount_type = null, discount_value = null, discount_starts = null, discount_ends = null, updated_at = now() where id = v.id;
      continue;
    end if;
    if kind not in ('percent', 'amount') then raise exception 'Choose percent or peso off for %.', v.label; end if;
    val := round((it->>'value')::numeric, 2);
    if kind = 'percent' and (val is null or val < 1 or val > 95) then raise exception 'Percent off for % must be from 1 to 95.', v.label; end if;
    if kind = 'amount' and (val is null or val <= 0 or val >= v.price) then raise exception 'Peso off for % must be above 0 and below its price.', v.label; end if;
    starts := nullif(it->>'starts', '')::date; ends := nullif(it->>'ends', '')::date;
    if starts is not null and ends is not null and ends < starts then raise exception 'The discount for % ends before it starts.', v.label; end if;
    update public.product_variants set discount_type = kind, discount_value = val, discount_starts = starts, discount_ends = ends, updated_at = now() where id = v.id;
  end loop;
end $$;
revoke all on function private.save_variant_discounts(uuid, jsonb) from public;
grant execute on function private.save_variant_discounts(uuid, jsonb) to authenticated;

create or replace function public.save_variant_discounts(target_product uuid, items jsonb) returns void
language sql security invoker set search_path = '' as $$ select private.save_variant_discounts(target_product, items) $$;
revoke all on function public.save_variant_discounts(uuid, jsonb) from public, anon;
grant execute on function public.save_variant_discounts(uuid, jsonb) to authenticated;


do $rehearsal$
declare
  admin_id uuid; customer_id uuid; v public.product_variants; slot_id uuid; report text := ''; ok boolean;
  def text; res jsonb; today date := (now() at time zone 'Asia/Manila')::date; expected numeric; ord public.orders; line public.order_items;
  admin_claims text; customer_claims text;
begin
  def := pg_get_functiondef('private.checkout(jsonb)'::regprocedure);
  ok := (length(def) - length(replace(def, 'private.variant_price_now(variant)', ''))) / length('private.variant_price_now(variant)') = 2
        and position('variant.price*qty' in def) = 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  checkout prices with variant_price_now (2 places)';

  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' limit 1;
  select u.id into customer_id from auth.users u join public.profiles p on p.id = u.id left join public.user_roles r on r.user_id = u.id
   where coalesce(r.role, 'customer') = 'customer' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
   order by u.created_at limit 1;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id
   left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 2 and pr.status = 'active' and pr.kind = 'standard' and (pr.category_id is null or c.is_active)
   order by pv.price desc limit 1;
  select s.id into slot_id from public.availability_slots s
   where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity
   order by s.starts_at limit 1;
  if admin_id is null or customer_id is null or v.id is null then raise exception 'REHEARSAL could not start.%', report; end if;
  admin_claims := json_build_object('sub', admin_id, 'role', 'authenticated')::text;
  customer_claims := json_build_object('sub', customer_id, 'role', 'authenticated')::text;

  ok := private.variant_price_now(v) = v.price;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  no discount: full price';

  -- as the admin
  perform set_config('request.jwt.claims', admin_claims, true); perform set_config('role', 'authenticated', true);
  perform public.save_variant_discounts(v.product_id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'type', 'percent', 'value', 10)));
  perform set_config('role', 'postgres', true);
  select * into v from public.product_variants where id = v.id;
  ok := private.variant_price_now(v) = round(v.price * 0.9, 2);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  10% off today: ' || private.variant_price_now(v) || ' instead of ' || v.price;

  perform set_config('role', 'authenticated', true);
  perform public.save_variant_discounts(v.product_id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'type', 'amount', 'value', 20, 'starts', today + 3)));
  perform set_config('role', 'postgres', true);
  select * into v from public.product_variants where id = v.id;
  ok := private.variant_price_now(v) = v.price;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  starts in 3 days: full price today';

  perform set_config('role', 'authenticated', true);
  perform public.save_variant_discounts(v.product_id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'type', 'amount', 'value', 20, 'ends', today - 1)));
  perform set_config('role', 'postgres', true);
  select * into v from public.product_variants where id = v.id;
  ok := private.variant_price_now(v) = v.price;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  ended yesterday: full price today';

  perform set_config('role', 'authenticated', true);
  begin perform public.save_variant_discounts(v.product_id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'type', 'amount', 'value', v.price)));
    report := report || E'\nFAIL  peso off equal to the price was allowed';
  exception when others then report := report || E'\nPASS  peso off equal to the price refused'; end;
  begin perform public.save_variant_discounts(v.product_id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'type', 'percent', 'value', 0)));
    report := report || E'\nFAIL  0% was allowed';
  exception when others then report := report || E'\nPASS  0% refused'; end;
  begin perform public.save_variant_discounts(v.product_id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'type', 'percent', 'value', 10, 'starts', today + 5, 'ends', today)));
    report := report || E'\nFAIL  end before start was allowed';
  exception when others then report := report || E'\nPASS  end before start refused'; end;
  perform public.save_variant_discounts(v.product_id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'type', 'amount', 'value', 20, 'starts', today, 'ends', today)));

  -- as a customer
  perform set_config('request.jwt.claims', customer_claims, true);
  begin perform public.save_variant_discounts(v.product_id, jsonb_build_array(jsonb_build_object('variant_id', v.id, 'type', 'percent', 'value', 50)));
    report := report || E'\nFAIL  a customer could save a discount';
  exception when others then report := report || E'\nPASS  customer refused'; end;
  perform set_config('role', 'postgres', true);
  select * into v from public.product_variants where id = v.id;
  expected := round(v.price - 20, 2);
  ok := private.variant_price_now(v) = expected;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  P20 off, today only: ' || private.variant_price_now(v);

  if slot_id is null then report := report || E'\nSKIP  pretend order (no open slot found)';
  else
    perform set_config('role', 'authenticated', true);
    begin
      res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567',
        'fulfillment', 'pickup', 'slot_id', slot_id, 'notes', 'phase 75 rehearsal',
        'payment_method', (select pm.code from public.payment_methods pm where pm.active order by pm.code limit 1),
        'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 2))));
      perform set_config('role', 'postgres', true);
      select * into ord from public.orders where id = (res->>'id')::uuid;
      select * into line from public.order_items where order_id = ord.id and line_number = 1;
      ok := line.unit_price = expected and ord.items_subtotal = expected * 2;
      report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  pretend order charged the discount: unit ' || line.unit_price || ', subtotal ' || ord.items_subtotal || ' (full price would be ' || v.price * 2 || ')';
    exception when others then perform set_config('role', 'postgres', true); report := report || E'\nFAIL  pretend order raised: ' || sqlerrm; end;
  end if;

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
