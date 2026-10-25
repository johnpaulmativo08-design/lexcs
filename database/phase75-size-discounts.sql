-- Phase 75 · Discounts per size, set by the owner in Admin → Products → Edit product.
--
-- Why: the owner wants to run promos — a percent or a peso amount off a particular size, optionally only between two
-- dates — and have the shop show the old price crossed out. Prices are never trusted from the browser, so the
-- discount has to be applied where orders are priced: private.checkout.
--
-- What it does:
--   1. Four new columns on public.product_variants (each size): discount_type ('percent' or 'amount'),
--      discount_value, discount_starts, discount_ends (dates, Asia/Manila; either may be empty = open-ended).
--      The normal price column is untouched, so turning a discount off simply brings the full price back.
--   2. private.variant_price_now(size) — today's selling price of a size: the full price, or the discounted price
--      when a discount is set and today (Manila) is within its dates. Percent off is rounded to centavos. A peso
--      discount that is not smaller than the price is ignored (never free or negative).
--   3. private.checkout uses variant_price_now for the order subtotal and each order line's unit price. Only those two
--      spots change; the live function is patched in place (like phases 36–38) and the patch refuses to run if the
--      expected text is not found exactly once. The downpayment, rush fee, design extras and everything else stay as
--      they are. Orders already placed keep the prices they were placed with.
--   4. public.save_variant_discounts(target_product, items) — admin only; checks every value (percent 1–95, peso
--      amount above 0 and below the size's price, end date not before start date) and saves them for that product's
--      sizes.
--
-- What it does NOT do: change payments, inventory, RLS policies, save_product, or any existing order.
--
-- How to apply: rehearse with database/tests/phase75-rehearsal.sql (rolls itself back), then run this whole file once
-- in the Supabase SQL editor.

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

notify pgrst, 'reload schema';
