-- Phase 98 · Delivery fee from a real Lalamove quotation (instead of the estimate from LexC's own rates).
--
-- Why: phase 94 estimates the delivery fee from rates the owner types in. The owner now has Lalamove API keys, so
-- checkout can ask Lalamove itself for the price of a rider from the shop to the customer's pin.
--
-- How it works:
--   * Admin → Delivery rates gets a choice "Where the fee comes from": Lalamove quotation, or My own rates (phase 94).
--   * With Lalamove chosen, the Edge Function supabase/functions/delivery-quote signs a request with the owner's
--     Lalamove keys (kept in Supabase → Edge Functions → Secrets, never in the site) and asks Lalamove for a
--     quotation. It then calls public.issue_lalamove_quote (service role only), which saves the price in
--     public.delivery_quotes like any other quote. Checkout and the order work exactly as in phase 94: the order
--     copies the saved fee; the browser never sets it.
--   * Asking Lalamove for a quotation is free and books nothing. The owner still books and pays the rider in the
--     Lalamove app. The price can change by the time the rider is booked (traffic, time of day, Lalamove's own
--     changes); the order keeps the quotation it was charged (delivery_pricing on the order) to compare.
--   * "Charge delivery fees at checkout" (enabled) still switches the whole fee on or off.
--
-- What it does NOT do: change any order, payment, the 60% downpayment, the rush fee, the rates already saved, or
-- store pickup. Nothing is deleted. Needs phase 94. Safe to re-run.
begin;

-- 1. Where the fee comes from
alter table public.delivery_pricing add column if not exists fee_source text not null default 'rates';
alter table public.delivery_pricing drop constraint if exists delivery_pricing_fee_source_check;
alter table public.delivery_pricing add constraint delivery_pricing_fee_source_check check (fee_source in ('rates', 'lalamove'));
alter table public.delivery_pricing add column if not exists lalamove_service text not null default 'MOTORCYCLE';
alter table public.delivery_pricing drop constraint if exists delivery_pricing_lalamove_service_check;
alter table public.delivery_pricing add constraint delivery_pricing_lalamove_service_check
  check (lalamove_service ~ '^[A-Z0-9_]{2,40}$');

-- phase 94 required a base fee before switching on; with Lalamove prices there is no base fee to enter
do $$ declare c text; begin
  for c in select conname from pg_constraint
    where conrelid = 'public.delivery_pricing'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%enabled%' and pg_get_constraintdef(oid) ilike '%base_fee IS NOT NULL%'
  loop execute format('alter table public.delivery_pricing drop constraint %I', c); end loop;
end $$;
alter table public.delivery_pricing drop constraint if exists delivery_pricing_ready_check;
alter table public.delivery_pricing add constraint delivery_pricing_ready_check
  check (not enabled or fee_source = 'lalamove' or base_fee is not null);

-- 2. Called by the Edge Function only (service role): save a Lalamove price as a quote for a signed-in customer.
create or replace function public.issue_lalamove_quote(customer uuid, lat numeric, lng numeric, town text,
  address_label text, distance_km numeric, duration_min numeric, fee numeric, lalamove jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rates public.delivery_pricing; breakdown jsonb; q public.delivery_quotes;
begin
  select * into rates from public.delivery_pricing where id = 1;
  if rates.id is null or not rates.enabled or rates.fee_source <> 'lalamove' then
    return jsonb_build_object('status', 'not_priced');
  end if;
  if fee is null or fee < 0 or fee > 99999 then raise exception 'No Lalamove price.' using errcode = '22023'; end if;
  if distance_km is null or distance_km < 0 then raise exception 'No driving distance.' using errcode = '22023'; end if;
  -- moving the pin around gives plenty of quotes, but not thousands
  if (select count(*) from public.delivery_quotes d where d.customer_id = customer and d.created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('status', 'busy');
  end if;
  if distance_km > rates.max_km then
    return jsonb_build_object('status', 'too_far', 'distance_km', round(distance_km, 2), 'max_km', rates.max_km);
  end if;
  breakdown := jsonb_build_object(
    'source', 'lalamove', 'estimate', false, 'vehicle', initcap(replace(lower(rates.lalamove_service), '_', ' ')),
    'service_type', rates.lalamove_service, 'fee', round(fee, 2),
    'quotation_id', left(coalesce(lalamove->>'quotation_id', ''), 80),
    'price_breakdown', coalesce(lalamove->'price_breakdown', '{}'::jsonb),
    'lalamove_expires_at', lalamove->>'expires_at', 'town', town);
  insert into public.delivery_quotes(customer_id, lat, lng, town, address_label, distance_km, duration_min, fee, pricing)
    values (customer, round(lat, 6), round(lng, 6), left(town, 60), left(address_label, 300), round(distance_km, 2),
            round(duration_min, 1), round(fee, 2), breakdown)
    returning * into q;
  return jsonb_build_object('status', 'ok', 'quote_id', q.id, 'fee', q.fee, 'distance_km', q.distance_km,
    'duration_min', q.duration_min, 'town', q.town, 'vehicle', breakdown->>'vehicle', 'source', 'lalamove',
    'expires_at', q.expires_at, 'pricing', breakdown);
end $$;
revoke all on function public.issue_lalamove_quote(uuid, numeric, numeric, text, text, numeric, numeric, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.issue_lalamove_quote(uuid, numeric, numeric, text, text, numeric, numeric, numeric, jsonb) to service_role;

-- 3. Admin: save the settings (phase 94's function, plus fee_source and the Lalamove vehicle)
create or replace function private.save_delivery_pricing(settings jsonb) returns public.delivery_pricing
language plpgsql security definer set search_path = '' as $$
declare r public.delivery_pricing; s jsonb := coalesce(settings->'surcharges', '[]'); item jsonb; clean jsonb := '[]';
  src text := coalesce(nullif(settings->>'fee_source', ''), 'rates');
  service text := upper(btrim(coalesce(nullif(settings->>'lalamove_service', ''), 'MOTORCYCLE')));
  towns text[] := array['Apalit','Arayat','Bacolor','Candaba','Angeles City','San Fernando','Floridablanca','Guagua','Lubao',
    'Mabalacat City','Macabebe','Magalang','Masantol','Mexico','Minalin','Porac','San Luis','San Simon','Santa Ana','Santa Rita',
    'Sasmuan','Santo Tomas'];
begin
  perform private.require_admin();
  if src not in ('rates', 'lalamove') then raise exception 'Choose where the delivery fee comes from.' using errcode = '22023'; end if;
  if service !~ '^[A-Z0-9_]{2,40}$' then raise exception 'Choose a Lalamove vehicle.' using errcode = '22023'; end if;
  if src = 'rates' and coalesce((settings->>'enabled')::boolean, false) and nullif(settings->>'base_fee', '') is null then
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
    fee_source = src,
    lalamove_service = service,
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

commit;
notify pgrst, 'reload schema';
