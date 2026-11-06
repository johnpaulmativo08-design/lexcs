-- Phase 103 · Vouchers (discount codes) — Admin → Vouchers, and a code box at checkout.
--
-- What the owner can set per voucher: code, fixed (₱) or percentage discount, minimum purchase, maximum discount
-- (for percentages), start and end dates, total usage limit, per-customer limit, and what it applies to (all
-- products, selected products, or selected categories). Vouchers can be switched on/off, edited and deleted
-- (a voucher already used on an order can only be switched off, so the order's record stays).
--
-- How a discount is trusted (the browser never decides it):
--   * At checkout the customer may type a code; public.preview_voucher(code, items) checks it and shows the discount.
--     Nothing is reserved by a preview.
--   * When the order is placed, public.create_order applies the voucher in the same transaction as the order
--     (private.apply_voucher): the voucher row is locked, every rule is checked again against the order's own
--     items, the discount is worked out from those items, and a redemption is recorded (one per order). If the
--     voucher is no longer valid, the order is not placed and the customer sees why.
--   * The discount comes off the order total: total = items + designs + delivery + rush + VAT − discount. The 60%
--     downpayment is worked out from the discounted total by the existing VAT/downpayment step.
--   * Usage counts only orders that are not cancelled, so a cancelled order gives its use back.
-- Eligible amount = the line total of the eligible items (designs included); delivery and rush fees never count.
--
-- What it does NOT do: change prices, existing orders, payments or the payment flow. Safe to re-run.
begin;

-- 1. vouchers and what they apply to ----------------------------------------------------------------------------
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9_-]{3,30}$'),
  description text check (description is null or length(description) <= 200),
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(10,2) not null check (discount_value > 0),
  min_purchase numeric(10,2) not null default 0 check (min_purchase >= 0),
  max_discount numeric(10,2) check (max_discount is null or max_discount > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  per_customer_limit integer not null default 1 check (per_customer_limit between 1 and 100),
  applies_to text not null default 'all' check (applies_to in ('all', 'products', 'categories')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index if not exists vouchers_code_key on public.vouchers (upper(code));
create table if not exists public.voucher_products (
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (voucher_id, product_id)
);
create table if not exists public.voucher_categories (
  voucher_id uuid not null references public.vouchers(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (voucher_id, category_id)
);
create table if not exists public.voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.vouchers(id) on delete restrict,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  eligible_amount numeric(12,2) not null check (eligible_amount >= 0),
  discount_amount numeric(12,2) not null check (discount_amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists voucher_redemptions_voucher_idx on public.voucher_redemptions (voucher_id, customer_id);

-- Admin reads everything; a customer reads only their own redemptions; nobody writes directly (functions do).
do $$ declare t text; begin
  foreach t in array array['vouchers', 'voucher_products', 'voucher_categories', 'voucher_redemptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_admin()))', t || '_admin_read', t);
  end loop;
end $$;
drop policy if exists voucher_redemptions_own on public.voucher_redemptions;
create policy voucher_redemptions_own on public.voucher_redemptions for select to authenticated using (customer_id = (select auth.uid()));

-- 2. what an order keeps ---------------------------------------------------------------------------------------
alter table public.orders add column if not exists voucher_id uuid references public.vouchers(id) on delete set null;
alter table public.orders add column if not exists voucher_code text;
alter table public.orders add column if not exists discount_amount numeric(12,2) not null default 0;
alter table public.orders drop constraint if exists orders_discount_amount_check;
alter table public.orders add constraint orders_discount_amount_check check (discount_amount >= 0);

-- the order-total rule now subtracts the discount (everything else as phase 94)
alter table public.orders drop constraint if exists orders_amounts_match;
alter table public.orders add constraint orders_amounts_match check (
  (delivery_fee_status = 'unquoted' and delivery_fee is null and total_amount is null and deposit_due is null)
  or (delivery_fee_status <> 'unquoted' and delivery_fee is not null
      and total_amount = items_subtotal + customization_total + delivery_fee + rush_fee + vat_amount - discount_amount
      and deposit_due = round((total_amount - vat_amount - case when delivery_in_deposit then delivery_fee else 0 end) * deposit_rate, 2)
                        + vat_amount + case when delivery_in_deposit then delivery_fee else 0 end));

-- 3. the rules, in one place --------------------------------------------------------------------------------------
-- returns the discount for an eligible amount, or raises the customer-facing reason it does not apply
create or replace function private.voucher_check(v public.vouchers, customer uuid, eligible numeric, at_time timestamptz default now())
returns numeric language plpgsql stable set search_path = '' as $$
declare used integer; mine integer; d numeric(12,2);
begin
  if v.id is null then raise exception 'That voucher code doesn''t exist. Check the spelling.' using errcode = '22023'; end if;
  if not v.is_active then raise exception 'This voucher isn''t active right now.' using errcode = '22023'; end if;
  if v.starts_at is not null and at_time < v.starts_at then
    raise exception 'This voucher starts on %.', to_char(v.starts_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY') using errcode = '22023'; end if;
  if v.ends_at is not null and at_time > v.ends_at then raise exception 'This voucher has expired.' using errcode = '22023'; end if;
  select count(*) into used from public.voucher_redemptions r join public.orders o on o.id = r.order_id
   where r.voucher_id = v.id and o.status <> 'cancelled';
  if v.usage_limit is not null and used >= v.usage_limit then raise exception 'This voucher has been fully used.' using errcode = '22023'; end if;
  select count(*) into mine from public.voucher_redemptions r join public.orders o on o.id = r.order_id
   where r.voucher_id = v.id and r.customer_id = customer and o.status <> 'cancelled';
  if mine >= v.per_customer_limit then raise exception 'You''ve already used this voucher.' using errcode = '22023'; end if;
  if coalesce(eligible, 0) <= 0 then raise exception 'This voucher doesn''t apply to the items in your cart.' using errcode = '22023'; end if;
  if eligible < v.min_purchase then
    raise exception 'This voucher needs a minimum of ₱% on eligible items.', to_char(v.min_purchase, 'FM999,999,990.00') using errcode = '22023'; end if;
  d := case when v.discount_type = 'percent' then round(eligible * v.discount_value / 100, 2) else v.discount_value end;
  if v.max_discount is not null then d := least(d, v.max_discount); end if;
  return least(d, eligible);
end $$;
revoke all on function private.voucher_check(public.vouchers, uuid, numeric, timestamptz) from public;

create or replace function private.voucher_covers(v public.vouchers, product uuid) returns boolean
language sql stable set search_path = '' as $$
  select v.applies_to = 'all'
      or (v.applies_to = 'products' and exists (select 1 from public.voucher_products vp where vp.voucher_id = v.id and vp.product_id = product))
      or (v.applies_to = 'categories' and exists (select 1 from public.voucher_categories vc join public.products p on p.category_id = vc.category_id
                                                   where vc.voucher_id = v.id and p.id = product))
$$;
revoke all on function private.voucher_covers(public.vouchers, uuid) from public;

-- 4. checkout preview: the cart's items (variant + qty) at today's prices, sale prices included. Reserves nothing.
create or replace function public.preview_voucher(voucher_code text, items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.vouchers; eligible numeric(12,2); d numeric(12,2);
begin
  if auth.uid() is null then raise exception 'Log in to use a voucher.' using errcode = '42501'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 or jsonb_array_length(items) > 100 then
    raise exception 'Your cart is empty.' using errcode = '22023'; end if;
  select * into v from public.vouchers where upper(code) = upper(btrim(coalesce(voucher_code, '')));
  select coalesce(sum(
           (case when pv.discount_type is not null and coalesce(pv.discount_value, 0) > 0
                  and (pv.discount_starts is null or pv.discount_starts <= (now() at time zone 'Asia/Manila')::date)
                  and (pv.discount_ends is null or pv.discount_ends >= (now() at time zone 'Asia/Manila')::date)
                 then case when pv.discount_type = 'percent' then round(pv.price * (1 - pv.discount_value / 100), 2)
                           else greatest(0, pv.price - pv.discount_value) end
                 else pv.price end) * greatest(1, least(999, (i->>'qty')::integer))), 0)
    into eligible
    from jsonb_array_elements(items) i
    join public.product_variants pv on pv.id = (i->>'variant_id')::uuid and pv.is_active
   where v.id is not null and private.voucher_covers(v, pv.product_id);
  d := private.voucher_check(v, auth.uid(), eligible);
  return jsonb_build_object('code', v.code, 'discount', d, 'eligible', eligible, 'description', v.description,
    'type', v.discount_type, 'value', v.discount_value);
end $$;
revoke all on function public.preview_voucher(text, jsonb) from public, anon;
grant execute on function public.preview_voucher(text, jsonb) to authenticated;

-- 5. applying it to a placed order (same transaction as the order; locks the voucher against simultaneous use) --
create or replace function private.apply_voucher(target_order uuid, voucher_code text) returns numeric
language plpgsql security definer set search_path = '' as $$
declare v public.vouchers; o public.orders; eligible numeric(12,2); d numeric(12,2);
begin
  select * into v from public.vouchers where upper(code) = upper(btrim(coalesce(voucher_code, ''))) for update;
  select * into o from public.orders where id = target_order for update;
  if o.id is null or o.customer_id <> auth.uid() then raise exception 'Order not found.' using errcode = '42501'; end if;
  if o.total_amount is null then raise exception 'A voucher can be used once the order has its final price.' using errcode = '22023'; end if;
  if exists (select 1 from public.voucher_redemptions where order_id = o.id) then raise exception 'This order already has a voucher.' using errcode = '22023'; end if;
  select coalesce(sum(oi.line_total), 0) into eligible from public.order_items oi
   where oi.order_id = o.id and v.id is not null and private.voucher_covers(v, oi.product_id);
  d := private.voucher_check(v, o.customer_id, eligible);
  d := least(d, o.total_amount - o.rush_fee - coalesce(o.delivery_fee, 0));   -- never below the fees
  if d <= 0 then raise exception 'This voucher doesn''t apply to the items in your cart.' using errcode = '22023'; end if;
  insert into public.voucher_redemptions(voucher_id, order_id, customer_id, code, eligible_amount, discount_amount)
    values (v.id, o.id, o.customer_id, v.code, eligible, d);
  -- the VAT/downpayment step (orders_vat) works the downpayment out again from the new total
  update public.orders set voucher_id = v.id, voucher_code = v.code, discount_amount = d, total_amount = total_amount - d where id = o.id;
  return d;
end $$;
revoke all on function private.apply_voucher(uuid, text) from public;
grant execute on function private.apply_voucher(uuid, text) to authenticated;

-- create_order (phase 94) + the voucher: if the code no longer applies, the whole order is undone with the reason
create or replace function public.create_order(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare res jsonb; code text := nullif(btrim(coalesce(payload->>'voucher_code', '')), ''); d numeric;
begin
  perform set_config('lexc.delivery_quote', coalesce(payload->>'delivery_quote_id', ''), true);
  res := private.checkout(payload);
  if code is not null then
    d := private.apply_voucher((res->>'id')::uuid, code);
    res := res || jsonb_build_object('voucher_code', upper(code), 'discount_amount', d);
  end if;
  return res;
end $$;
revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to authenticated;

-- 6. functions that rebuild an order total keep the discount -------------------------------------------------------
create or replace function private.respond_order_extra(target_order uuid, accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; review jsonb; add numeric(12,2); thread_id uuid; total numeric(12,2);
begin
  if auth.uid() is null then raise exception 'Sign in to answer this price.' using errcode = '42501'; end if;
  select * into o from public.orders where id = target_order and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'Order not found.' using errcode = '42501'; end if;
  review := o.price_review;
  if review->>'status' is distinct from 'awaiting' then raise exception 'There is no new price waiting for your answer.' using errcode = '22023'; end if;
  if o.status <> 'pending' then raise exception 'This order can no longer change price.' using errcode = '22023'; end if;
  add := (review->>'amount')::numeric;
  thread_id := private.order_thread(o);
  if accept then
    total := case when o.total_amount is null then null else o.items_subtotal + o.customization_total + add + coalesce(o.delivery_fee, 0) + o.rush_fee - o.discount_amount end;
    review := review || jsonb_build_object('status', 'accepted', 'responded_at', now(), 'new_total', total);
    update public.orders set customization_total = customization_total + add, extra_charge = extra_charge + add,
      extra_charge_reason = btrim(coalesce(extra_charge_reason || ' · ', '') || (review->>'reason')),
      total_amount = total, deposit_due = case when total is null then null else round(total * deposit_rate, 2) end,
      price_review = review
    where id = o.id returning * into o;
    insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id)
      values (thread_id, 'system', 'status_update', 'The customer accepted the new price' || coalesce(' — new total ₱' || to_char(o.total_amount, 'FM999,999,990.00'), '') || '.', o.id);
    -- payment opens straight away when the price is final (a delivery order still waits for its Lalamove fee)
    if o.total_amount is not null then update public.orders set status = 'confirmed' where id = o.id returning * into o; end if;
  else
    review := review || jsonb_build_object('status', 'declined', 'responded_at', now());
    update public.orders set price_review = review where id = o.id returning * into o;
    insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id)
      values (thread_id, 'system', 'status_update', 'The customer declined the additional price. LexC''s will follow up here.', o.id);
  end if;
  update public.chat_messages set attachments = attachments || jsonb_build_object('status', review->>'status', 'responded_at', review->'responded_at')
    where order_id = o.id and message_type = 'price_review' and attachments->>'status' = 'awaiting';
  update public.chat_conversations set updated_at = now(), state = 'needs_admin' where id = thread_id;
  return jsonb_build_object('status', review->>'status', 'order_status', o.status, 'total_amount', o.total_amount, 'deposit_due', o.deposit_due);
end $$;

create or replace function private.quote_order_delivery(target_order uuid, quoted_fee numeric)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Admin access required.' using errcode='42501';
  end if;
  if quoted_fee is null or quoted_fee < 0 or quoted_fee > 99999
    or quoted_fee <> round(quoted_fee, 2) then
    raise exception 'Enter a valid delivery fee in pesos and centavos.';
  end if;
  select * into o from public.orders where id=target_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if o.fulfillment_method <> 'lalamove' or o.status='cancelled' then
    raise exception 'Only an active delivery order can receive a quote.';
  end if;
  if exists (select 1 from public.order_payment_attempts p where p.order_id=o.id) then
    raise exception 'The delivery quote cannot change after payment has started. Resolve the payment first.';
  end if;
  update public.orders set delivery_fee=quoted_fee, delivery_fee_status='quoted',
    total_amount=items_subtotal+customization_total+quoted_fee+rush_fee-discount_amount,
    deposit_due=round((items_subtotal+customization_total+quoted_fee+rush_fee-discount_amount)*deposit_rate,2)
    where id=o.id returning * into o;
  return o;
end $$;

-- 7. Admin: save, switch on/off and delete vouchers ---------------------------------------------------------------
create or replace function private.save_voucher(payload jsonb) returns public.vouchers
language plpgsql security definer set search_path = '' as $$
declare v public.vouchers; vid uuid := nullif(payload->>'id', '')::uuid; c text := upper(btrim(coalesce(payload->>'code', '')));
  kind text := coalesce(payload->>'applies_to', 'all'); x text;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  if c !~ '^[A-Z0-9_-]{3,30}$' then raise exception 'Use 3–30 letters, numbers, - or _ for the code.' using errcode = '22023'; end if;
  if exists (select 1 from public.vouchers where upper(code) = c and id is distinct from vid) then raise exception 'Another voucher already uses the code %.', c using errcode = '22023'; end if;
  if vid is null then
    insert into public.vouchers(code, discount_type, discount_value) values (c, coalesce(payload->>'discount_type', 'fixed'), coalesce(nullif(payload->>'discount_value', '')::numeric, 1)) returning * into v;
    vid := v.id;
  end if;
  update public.vouchers set code = c,
    description = nullif(btrim(coalesce(payload->>'description', '')), ''),
    discount_type = payload->>'discount_type',
    discount_value = nullif(payload->>'discount_value', '')::numeric,
    min_purchase = coalesce(nullif(payload->>'min_purchase', '')::numeric, 0),
    max_discount = nullif(payload->>'max_discount', '')::numeric,
    starts_at = nullif(payload->>'starts_at', '')::timestamptz,
    ends_at = nullif(payload->>'ends_at', '')::timestamptz,
    usage_limit = nullif(payload->>'usage_limit', '')::integer,
    per_customer_limit = coalesce(nullif(payload->>'per_customer_limit', '')::integer, 1),
    applies_to = kind,
    is_active = coalesce((payload->>'is_active')::boolean, true),
    updated_at = now()
  where id = vid returning * into v;
  if v.id is null then raise exception 'Voucher not found.' using errcode = '22023'; end if;
  delete from public.voucher_products where voucher_id = vid;
  delete from public.voucher_categories where voucher_id = vid;
  if kind = 'products' then
    for x in select jsonb_array_elements_text(coalesce(payload->'product_ids', '[]')) loop
      insert into public.voucher_products values (vid, x::uuid) on conflict do nothing; end loop;
    if not exists (select 1 from public.voucher_products where voucher_id = vid) then raise exception 'Pick at least one product.' using errcode = '22023'; end if;
  elsif kind = 'categories' then
    for x in select jsonb_array_elements_text(coalesce(payload->'category_ids', '[]')) loop
      insert into public.voucher_categories values (vid, x::uuid) on conflict do nothing; end loop;
    if not exists (select 1 from public.voucher_categories where voucher_id = vid) then raise exception 'Pick at least one category.' using errcode = '22023'; end if;
  end if;
  return v;
end $$;
revoke all on function private.save_voucher(jsonb) from public;
grant execute on function private.save_voucher(jsonb) to authenticated;
create or replace function public.save_voucher(payload jsonb) returns public.vouchers
language sql security invoker set search_path = '' as $$ select private.save_voucher(payload) $$;
revoke all on function public.save_voucher(jsonb) from public, anon;
grant execute on function public.save_voucher(jsonb) to authenticated;

create or replace function private.set_voucher_active(target uuid, active boolean) returns public.vouchers
language plpgsql security definer set search_path = '' as $$
declare v public.vouchers;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  update public.vouchers set is_active = coalesce(active, false), updated_at = now() where id = target returning * into v;
  if v.id is null then raise exception 'Voucher not found.' using errcode = '22023'; end if;
  return v;
end $$;
revoke all on function private.set_voucher_active(uuid, boolean) from public;
grant execute on function private.set_voucher_active(uuid, boolean) to authenticated;
create or replace function public.set_voucher_active(target uuid, active boolean) returns public.vouchers
language sql security invoker set search_path = '' as $$ select private.set_voucher_active(target, active) $$;
revoke all on function public.set_voucher_active(uuid, boolean) from public, anon;
grant execute on function public.set_voucher_active(uuid, boolean) to authenticated;

create or replace function private.delete_voucher(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  if exists (select 1 from public.voucher_redemptions where voucher_id = target) then
    raise exception 'This voucher was used on orders, so it can only be switched off (its order records stay).' using errcode = '22023'; end if;
  delete from public.vouchers where id = target;
end $$;
revoke all on function private.delete_voucher(uuid) from public;
grant execute on function private.delete_voucher(uuid) to authenticated;
create or replace function public.delete_voucher(target uuid) returns void
language sql security invoker set search_path = '' as $$ select private.delete_voucher(target) $$;
revoke all on function public.delete_voucher(uuid) from public, anon;
grant execute on function public.delete_voucher(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
