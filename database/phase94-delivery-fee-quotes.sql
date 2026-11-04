-- Phase 94 · Automatic Lalamove delivery fee (an ESTIMATE from LexC's own rates, not a Lalamove quotation).
--
-- Why: delivery orders were priced like pickup and the customer paid the Lalamove rider (phase 52). Now the customer
-- pays LexC's the delivery fee with the first payment, and LexC's books and pays the rider. The fee is worked out
-- from the driving distance between the shop and the customer's pin, using rates the owner enters in Admin.
--
-- How the fee is trusted (the browser never decides it):
--   1. The Edge Function supabase/functions/delivery-quote (server) checks the pin is inside Pampanga, gets the
--      driving distance from OSRM, and calls public.issue_delivery_quote (service role only). That function prices it
--      with public.delivery_pricing and saves the result in public.delivery_quotes, which customers can read but
--      never write.
--   2. Checkout sends only the quote's id. The database looks the quote up (it must belong to the customer, be less
--      than 2 hours old and unused) and copies its fee, distance and pin onto the order.
--   3. While rates are switched on, a delivery order without a valid quote is refused.
--
-- Money rules for the delivery fee (owner's choice):
--   * no 12% VAT on the delivery fee;
--   * all of it is collected with the first payment (downpayment or full payment).
--   So for a new delivery order: VAT = 12% of (items + designs + rush fee); downpayment = 60% of those + VAT +
--   delivery fee; total = those + VAT + delivery fee. Older orders have delivery_in_deposit = false and keep their
--   amounts exactly.
--
-- Until the owner switches rates on (Admin → Delivery rates), delivery works as before: ₱0 fee, rider paid directly.
--
-- What it does NOT do: change prices, products, the 60% rate, VAT on items, the rush fee, payments already made, or
-- any existing order. Store pickup is unchanged.
--
-- How to apply: rehearse with database/tests/phase94-rehearsal.sql (rolls itself back), then run this whole file once
-- in the Supabase SQL editor. Safe to re-run.
begin;

-- 1. Rates (one row). Nothing is filled in: the owner enters rates they have checked.
create table if not exists public.delivery_pricing (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  vehicle text not null default 'Motorcycle' check (length(btrim(vehicle)) between 1 and 40),
  base_fee numeric(10,2) check (base_fee is null or base_fee between 0 and 99999),
  included_km numeric(6,2) not null default 0 check (included_km between 0 and 500),
  per_km_fee numeric(10,2) not null default 0 check (per_km_fee between 0 and 9999),
  km_counting text not null default 'exact' check (km_counting in ('exact', 'started_km')),
  minimum_fee numeric(10,2) not null default 0 check (minimum_fee between 0 and 99999),
  round_to numeric(6,2) not null default 1 check (round_to in (0.01, 1, 5, 10)),
  round_mode text not null default 'up' check (round_mode in ('up', 'nearest')),
  surcharges jsonb not null default '[]' check (jsonb_typeof(surcharges) = 'array'),
  max_km numeric(6,1) not null default 80 check (max_km between 1 and 500),
  source_note text check (source_note is null or length(source_note) <= 300),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check (not enabled or base_fee is not null)
);
insert into public.delivery_pricing (id) values (1) on conflict (id) do nothing;
alter table public.delivery_pricing enable row level security;
revoke all on public.delivery_pricing from anon, authenticated;
grant select on public.delivery_pricing to anon, authenticated;   -- the rates are not secret: checkout may explain them
drop policy if exists delivery_pricing_read on public.delivery_pricing;
create policy delivery_pricing_read on public.delivery_pricing for select to anon, authenticated using (true);

-- 2. Quotes: written only by the server (service role); a customer can read their own.
create table if not exists public.delivery_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  town text check (town is null or length(town) <= 60),
  address_label text check (address_label is null or length(address_label) <= 300),
  distance_km numeric(7,2) not null check (distance_km >= 0),
  duration_min numeric(7,1) check (duration_min is null or duration_min >= 0),
  fee numeric(10,2) not null check (fee >= 0),
  pricing jsonb not null,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);
create index if not exists delivery_quotes_customer_idx on public.delivery_quotes(customer_id, created_at desc);
alter table public.delivery_quotes enable row level security;
revoke all on public.delivery_quotes from anon, authenticated;
grant select on public.delivery_quotes to authenticated;
drop policy if exists delivery_quotes_own on public.delivery_quotes;
create policy delivery_quotes_own on public.delivery_quotes for select to authenticated
  using (customer_id = (select auth.uid()) or private.is_admin());

-- 3. What the order keeps about its delivery
alter table public.orders add column if not exists delivery_in_deposit boolean not null default false;
alter table public.orders add column if not exists delivery_lat numeric(9,6);
alter table public.orders add column if not exists delivery_lng numeric(9,6);
alter table public.orders add column if not exists delivery_distance_km numeric(7,2);
alter table public.orders add column if not exists delivery_quote_id uuid references public.delivery_quotes(id) on delete set null;
alter table public.orders add column if not exists delivery_pricing jsonb;

-- 4. The fee for a distance and town under the current rates (the only place the rates are applied).
create or replace function private.delivery_fee_for(distance_km numeric, town text, rates public.delivery_pricing)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare km numeric := greatest(0, coalesce(distance_km, 0)); extra_km numeric; distance_part numeric;
  surcharge numeric := 0; fee numeric; raw numeric; step numeric := rates.round_to;
begin
  extra_km := greatest(0, km - rates.included_km);
  if rates.km_counting = 'started_km' then extra_km := ceil(extra_km); end if;
  distance_part := extra_km * rates.per_km_fee;
  select coalesce(sum((s->>'amount')::numeric), 0) into surcharge
    from jsonb_array_elements(rates.surcharges) s where lower(s->>'town') = lower(coalesce(town, ''));
  raw := greatest(rates.base_fee + distance_part + surcharge, rates.minimum_fee);
  fee := case when rates.round_mode = 'up' then ceil(raw / step) * step else round(raw / step) * step end;
  return jsonb_build_object(
    'vehicle', rates.vehicle, 'base_fee', rates.base_fee, 'included_km', rates.included_km, 'per_km_fee', rates.per_km_fee,
    'km_counting', rates.km_counting, 'extra_km', round(extra_km, 2), 'distance_part', round(distance_part, 2),
    'town', town, 'surcharge', surcharge, 'minimum_fee', rates.minimum_fee, 'round_to', rates.round_to,
    'round_mode', rates.round_mode, 'before_rounding', round(raw, 2), 'fee', round(fee, 2),
    'rates_updated_at', rates.updated_at, 'estimate', true);
end $$;
revoke all on function private.delivery_fee_for(numeric, text, public.delivery_pricing) from public;

-- 5. Called by the Edge Function only (service role): price and save a quote for a signed-in customer.
create or replace function public.issue_delivery_quote(customer uuid, lat numeric, lng numeric, town text,
  address_label text, distance_km numeric, duration_min numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rates public.delivery_pricing; breakdown jsonb; q public.delivery_quotes;
begin
  select * into rates from public.delivery_pricing where id = 1;
  if rates.id is null or not rates.enabled then
    return jsonb_build_object('status', 'not_priced');   -- rates not switched on: delivery works as before
  end if;
  if distance_km is null or distance_km < 0 then raise exception 'No driving distance.' using errcode = '22023'; end if;
  -- a customer moving the pin around gets plenty of quotes, but not thousands (the route server is a shared, free one)
  if (select count(*) from public.delivery_quotes d where d.customer_id = customer and d.created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('status', 'busy');
  end if;
  if distance_km > rates.max_km then
    return jsonb_build_object('status', 'too_far', 'distance_km', round(distance_km, 2), 'max_km', rates.max_km);
  end if;
  breakdown := private.delivery_fee_for(distance_km, town, rates);
  insert into public.delivery_quotes(customer_id, lat, lng, town, address_label, distance_km, duration_min, fee, pricing)
    values (customer, round(lat, 6), round(lng, 6), left(town, 60), left(address_label, 300), round(distance_km, 2),
            round(duration_min, 1), (breakdown->>'fee')::numeric, breakdown)
    returning * into q;
  return jsonb_build_object('status', 'ok', 'quote_id', q.id, 'fee', q.fee, 'distance_km', q.distance_km,
    'duration_min', q.duration_min, 'town', q.town, 'vehicle', rates.vehicle, 'expires_at', q.expires_at, 'pricing', breakdown);
end $$;
revoke all on function public.issue_delivery_quote(uuid, numeric, numeric, text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.issue_delivery_quote(uuid, numeric, numeric, text, text, numeric, numeric) to service_role;

-- 6. Admin: save the rates (and an example price for a distance, to check them before switching on)
create or replace function private.save_delivery_pricing(settings jsonb) returns public.delivery_pricing
language plpgsql security definer set search_path = '' as $$
declare r public.delivery_pricing; s jsonb := coalesce(settings->'surcharges', '[]'); item jsonb; clean jsonb := '[]';
  towns text[] := array['Apalit','Arayat','Bacolor','Candaba','Angeles City','San Fernando','Floridablanca','Guagua','Lubao',
    'Mabalacat City','Macabebe','Magalang','Masantol','Mexico','Minalin','Porac','San Luis','San Simon','Santa Ana','Santa Rita',
    'Sasmuan','Santo Tomas'];
begin
  perform private.require_admin();
  if coalesce((settings->>'enabled')::boolean, false) and nullif(settings->>'base_fee', '') is null then
    raise exception 'Enter the base fee before switching delivery fees on.' using errcode = '22023';
  end if;
  if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) > 22 then raise exception 'Invalid area surcharges.' using errcode = '22023'; end if;
  for item in select * from jsonb_array_elements(s) loop
    if not (item->>'town' = any(towns)) then raise exception 'Unknown town: %', item->>'town' using errcode = '22023'; end if;
    if (item->>'amount') !~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' then raise exception 'Enter the surcharge for % in pesos.', item->>'town' using errcode = '22023'; end if;
    clean := clean || jsonb_build_array(jsonb_build_object('town', item->>'town', 'amount', (item->>'amount')::numeric));
  end loop;
  update public.delivery_pricing set
    enabled = coalesce((settings->>'enabled')::boolean, false),
    vehicle = btrim(coalesce(settings->>'vehicle', 'Motorcycle')),
    base_fee = nullif(settings->>'base_fee', '')::numeric,
    included_km = coalesce(nullif(settings->>'included_km', '')::numeric, 0),
    per_km_fee = coalesce(nullif(settings->>'per_km_fee', '')::numeric, 0),
    km_counting = coalesce(settings->>'km_counting', 'exact'),
    minimum_fee = coalesce(nullif(settings->>'minimum_fee', '')::numeric, 0),
    round_to = coalesce(nullif(settings->>'round_to', '')::numeric, 1),
    round_mode = coalesce(settings->>'round_mode', 'up'),
    max_km = coalesce(nullif(settings->>'max_km', '')::numeric, 80),
    surcharges = clean,
    source_note = nullif(btrim(coalesce(settings->>'source_note', '')), ''),
    updated_at = now(), updated_by = (select auth.uid())
  where id = 1 returning * into r;
  return r;
end $$;
revoke all on function private.save_delivery_pricing(jsonb) from public;
grant execute on function private.save_delivery_pricing(jsonb) to authenticated;
create or replace function public.save_delivery_pricing(settings jsonb) returns public.delivery_pricing
language sql security invoker set search_path = '' as $$ select private.save_delivery_pricing(settings) $$;
revoke all on function public.save_delivery_pricing(jsonb) from public;
grant execute on function public.save_delivery_pricing(jsonb) to authenticated;

create or replace function public.preview_delivery_fee(distance_km numeric, town text default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.delivery_fee_for(distance_km, town, p) from public.delivery_pricing p where p.id = 1 and p.base_fee is not null
$$;
revoke all on function public.preview_delivery_fee(numeric, text) from public;
grant execute on function public.preview_delivery_fee(numeric, text) to authenticated;
grant execute on function private.delivery_fee_for(numeric, text, public.delivery_pricing) to authenticated;

-- 7. Checkout: pass the chosen quote to the order (a setting that lives only for this transaction)
create or replace function public.create_order(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  perform set_config('lexc.delivery_quote', coalesce(payload->>'delivery_quote_id', ''), true);
  return private.checkout(payload);
end $$;
revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to authenticated;

-- 8. Before the order is saved: copy the quote (runs after orders_prepare_manual_payment, before the rush fee and VAT)
create or replace function private.order_delivery_quote() returns trigger
language plpgsql security definer set search_path = '' as $$
declare qid text := nullif(current_setting('lexc.delivery_quote', true), ''); q public.delivery_quotes; on_rates boolean;
begin
  if new.fulfillment_method <> 'lalamove' then return new; end if;
  select enabled into on_rates from public.delivery_pricing where id = 1;
  if qid is null then
    if coalesce(on_rates, false) then
      raise exception 'Pin your delivery spot on the map so we can work out the delivery fee.' using errcode = '22023';
    end if;
    return new;                                     -- rates off: as before (₱0, rider paid directly)
  end if;
  if qid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'The delivery fee is not valid. Pin your address again.' using errcode = '22023';
  end if;
  select * into q from public.delivery_quotes where id = qid::uuid for update;
  if q.id is null or q.customer_id <> new.customer_id then
    raise exception 'The delivery fee is not valid. Pin your address again.' using errcode = '22023';
  end if;
  if q.order_id is not null then raise exception 'This delivery fee was already used. Pin your address again.' using errcode = '22023'; end if;
  if q.expires_at < now() then raise exception 'The delivery fee expired. Pin your address again to refresh it.' using errcode = '22023'; end if;
  new.delivery_fee := q.fee;
  new.delivery_fee_status := 'quoted';
  new.delivery_in_deposit := true;
  new.delivery_lat := q.lat; new.delivery_lng := q.lng;
  new.delivery_distance_km := q.distance_km;
  new.delivery_quote_id := q.id;
  new.delivery_pricing := q.pricing || jsonb_build_object('distance_km', q.distance_km, 'duration_min', q.duration_min, 'quoted_at', q.created_at);
  -- the pin saved in the address is the one that was priced
  new.address := regexp_replace(coalesce(new.address, ''), '\s*Map pin: https://maps\.google\.com/\?q=\S+\s*$', '')
    || E'\nMap pin: https://maps.google.com/?q=' || q.lat::text || ',' || q.lng::text;
  if new.total_amount is not null then new.total_amount := new.total_amount + q.fee; end if;
  return new;
end $$;
revoke all on function private.order_delivery_quote() from public;
drop trigger if exists orders_quoted_delivery on public.orders;
create trigger orders_quoted_delivery before insert on public.orders
  for each row execute function private.order_delivery_quote();

create or replace function private.order_delivery_quote_used() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.delivery_quote_id is not null then
    update public.delivery_quotes set order_id = new.id where id = new.delivery_quote_id;
  end if;
  return null;
end $$;
revoke all on function private.order_delivery_quote_used() from public;
drop trigger if exists orders_quote_used on public.orders;
create trigger orders_quote_used after insert on public.orders
  for each row execute function private.order_delivery_quote_used();

-- 9. VAT step: the delivery fee carries no VAT and is all in the first payment (orders with delivery_in_deposit)
create or replace function private.order_vat() returns trigger
language plpgsql set search_path = '' as $$
declare amount numeric(12,2); dlv numeric(12,2);
begin
  if tg_op = 'UPDATE' and new.total_amount is not distinct from old.total_amount then return new; end if;
  if new.total_amount is null then new.vat_amount := 0; return new; end if;
  amount := new.total_amount;                       -- the order amount before VAT, as just worked out
  dlv := case when new.delivery_in_deposit then coalesce(new.delivery_fee, 0) else 0 end;
  new.vat_amount := round((amount - dlv) * new.vat_rate, 2);
  new.total_amount := amount + new.vat_amount;
  new.deposit_due := round((amount - dlv) * new.deposit_rate, 2) + new.vat_amount + dlv;
  return new;
end $$;
revoke all on function private.order_vat() from public;

alter table public.orders drop constraint if exists orders_amounts_match;
alter table public.orders add constraint orders_amounts_match check (
  (delivery_fee_status = 'unquoted' and delivery_fee is null and total_amount is null and deposit_due is null)
  or (delivery_fee_status <> 'unquoted' and delivery_fee is not null
      and total_amount = items_subtotal + customization_total + delivery_fee + rush_fee + vat_amount
      and deposit_due = round((total_amount - vat_amount - case when delivery_in_deposit then delivery_fee else 0 end) * deposit_rate, 2)
                        + vat_amount + case when delivery_in_deposit then delivery_fee else 0 end));

commit;
notify pgrst, 'reload schema';
