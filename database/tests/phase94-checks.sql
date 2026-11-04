-- Phase 94 checks (the part of phase94-rehearsal.sql after the migration). Kept separate so the rehearsal can be
-- rebuilt from the migration with scripts/build-rehearsal.sh 94. Runs inside the rehearsal's transaction and
-- ends with an error on purpose, so nothing is saved.
do $rehearsal$
declare
  customer_id uuid; other_id uuid; admin_id uuid; v public.product_variants; slot_id uuid; method text; res jsonb; q jsonb; q2 jsonb;
  ord public.orders; pick public.orders; old_way public.orders; dq public.delivery_quotes; report text := ''; ok boolean; items numeric; vat numeric;
  saved_rates public.delivery_pricing;
  pay jsonb;
begin
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' order by ur.created_at limit 1;
  select ur.user_id into customer_id from public.user_roles ur where ur.role = 'customer' order by ur.created_at limit 1;
  select ur.user_id into other_id from public.user_roles ur where ur.role = 'customer' and ur.user_id <> customer_id order by ur.created_at limit 1;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 1 and pr.status = 'active' and pr.kind = 'standard' and (pr.category_id is null or c.is_active) order by pv.price desc limit 1;
  select s.id into slot_id from public.availability_slots s where s.is_open and s.starts_at > now() + interval '3 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity order by s.starts_at limit 1;
  select code into method from public.payment_methods where active and code <> 'paymongo' order by code limit 1;
  select * into saved_rates from public.delivery_pricing where id = 1;
  pay := jsonb_build_object('name', 'Rehearsal', 'phone', '09171234567', 'slot_id', slot_id, 'notes', 'phase 94 rehearsal', 'payment_method', method,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1)));

  -- rates start switched off (unless the owner already switched them on)
  perform set_config('role', 'postgres', true);
  update public.delivery_pricing set enabled = false where id = 1;

  -- 1. rates off: a delivery order works exactly as before (₱0 fee, rider paid directly)
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', customer_id::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'lalamove', 'address', 'Blk 1 Lot 2, Dau, Mabalacat City'));
  perform set_config('role', 'postgres', true);
  select * into old_way from public.orders where id = (res->>'id')::uuid;
  ok := old_way.delivery_fee = 0 and old_way.delivery_fee_status = 'not_applicable' and not old_way.delivery_in_deposit
    and old_way.deposit_due = round((old_way.total_amount - old_way.vat_amount) * old_way.deposit_rate, 2) + old_way.vat_amount;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  rates off: delivery order has ₱0 fee and the old downpayment rule';

  -- 2. a customer cannot set rates or issue quotes
  perform set_config('role', 'authenticated', true);
  begin perform public.save_delivery_pricing('{"enabled":true,"base_fee":1}'); report := report || E'\nFAIL  a customer could change the rates';
  exception when others then report := report || E'\nPASS  a customer cannot change the rates'; end;
  begin perform public.issue_delivery_quote(customer_id, 15.1, 120.6, 'Porac', 'x', 1, 1); report := report || E'\nFAIL  a customer could issue a quote';
  exception when others then report := report || E'\nPASS  a customer cannot issue a quote (' || sqlerrm || ')'; end;
  begin update public.delivery_pricing set base_fee = 1 where id = 1;
    if found then report := report || E'\nFAIL  a customer could edit the rates table'; else report := report || E'\nPASS  a customer cannot edit the rates table'; end if;
  exception when others then report := report || E'\nPASS  a customer cannot edit the rates table'; end;

  -- 3. the admin saves example rates (NOT real Lalamove rates; only to test the arithmetic)
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform public.save_delivery_pricing('{"enabled":true,"vehicle":"Motorcycle","base_fee":"100","included_km":"3","per_km_fee":"10",
    "km_counting":"exact","minimum_fee":"0","round_to":"1","round_mode":"up","max_km":"60","surcharges":[{"town":"Porac","amount":"30"}],"source_note":"rehearsal"}');
  q := public.preview_delivery_fee(8.5, 'Mabalacat City');
  report := report || E'\n' || case when (q->>'fee')::numeric = 155 then 'PASS' else 'FAIL' end || '  8.5 km at ₱100 + ₱10/km after 3 km = ₱' || (q->>'fee');
  q := public.preview_delivery_fee(8.5, 'Porac');
  report := report || E'\n' || case when (q->>'fee')::numeric = 185 then 'PASS' else 'FAIL' end || '  Porac surcharge ₱30 → ₱' || (q->>'fee');
  q := public.preview_delivery_fee(2, null);
  report := report || E'\n' || case when (q->>'fee')::numeric = 100 then 'PASS' else 'FAIL' end || '  2 km (inside the included 3 km) = base fee ₱' || (q->>'fee');
  begin perform public.save_delivery_pricing('{"enabled":true,"base_fee":"100","surcharges":[{"town":"Tarlac City","amount":"5"}]}');
    report := report || E'\nFAIL  a town outside Pampanga was accepted';
  exception when others then report := report || E'\nPASS  surcharges only for Pampanga towns (' || sqlerrm || ')'; end;
  begin perform public.save_delivery_pricing('{"enabled":true}'); report := report || E'\nFAIL  rates switched on without a base fee';
  exception when others then report := report || E'\nPASS  rates cannot be switched on without a base fee'; end;

  -- 4. the server (service role) issues quotes
  perform set_config('role', 'service_role', true);
  q := public.issue_delivery_quote(customer_id, 15.172157 + 0.05, 120.58621, 'Mabalacat City', 'Rehearsal St., Mabalacat', 8.5, 18);
  q2 := public.issue_delivery_quote(customer_id, 15.0, 120.4, 'Porac', 'far', 75, 90);
  perform set_config('role', 'postgres', true);
  report := report || E'\n' || case when q->>'status' = 'ok' and (q->>'fee')::numeric = 155 then 'PASS' else 'FAIL' end || '  quote issued: ' || q::text;
  report := report || E'\n' || case when q2->>'status' = 'too_far' then 'PASS' else 'FAIL' end || '  farther than the maximum distance is refused';

  -- 5. with rates on, a delivery order without a quote is refused
  perform set_config('request.jwt.claim.sub', customer_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  begin perform public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'lalamove', 'address', 'Blk 1 Lot 2, Dau, Mabalacat City'));
    report := report || E'\nFAIL  delivery order without a fee was accepted';
  exception when others then report := report || E'\nPASS  delivery without a quote is refused (' || sqlerrm || ')'; end;
  begin perform public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'lalamove', 'address', 'Blk 1 Lot 2, Dau, Mabalacat City', 'delivery_quote_id', 'not-a-uuid'));
    report := report || E'\nFAIL  a made-up quote id was accepted';
  exception when others then report := report || E'\nPASS  a made-up quote id is refused'; end;

  -- 6. the order with the quote: fee, distance, pin, and the money rules
  res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'lalamove', 'delivery_quote_id', q->>'quote_id',
    'address', E'Blk 1 Lot 2, Dau, Mabalacat City\nMap pin: https://maps.google.com/?q=14.000000,120.000000'));
  perform set_config('role', 'postgres', true);
  select * into ord from public.orders where id = (res->>'id')::uuid;
  items := ord.items_subtotal + ord.customization_total + ord.rush_fee; vat := round(items * ord.vat_rate, 2);
  ok := ord.delivery_fee = 155 and ord.delivery_fee_status = 'quoted' and ord.delivery_in_deposit and ord.delivery_distance_km = 8.5
    and ord.vat_amount = vat and ord.total_amount = items + vat + 155 and ord.deposit_due = round(items * ord.deposit_rate, 2) + vat + 155;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  order: items ₱%s, VAT ₱%s (none on delivery), delivery ₱%s, total ₱%s, downpayment ₱%s (all of the delivery fee)',
    items, ord.vat_amount, ord.delivery_fee, ord.total_amount, ord.deposit_due);
  ok := ord.address like '%Map pin: https://maps.google.com/?q=' || ord.delivery_lat || ',' || ord.delivery_lng and ord.address not like '%14.000000%';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  the saved pin is the priced one (a different pin in the address was replaced)';
  ok := (ord.delivery_pricing->>'fee')::numeric = 155 and ord.delivery_pricing->>'vehicle' = 'Motorcycle' and (ord.delivery_pricing->>'estimate')::boolean;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  the rate used is kept with the order: ' || (ord.delivery_pricing - 'rates_updated_at')::text;
  select * into dq from public.delivery_quotes where id = (q->>'quote_id')::uuid;
  report := report || E'\n' || case when dq.order_id = ord.id then 'PASS' else 'FAIL' end || '  the quote is marked used by the order';

  -- 7. a quote cannot be reused, borrowed, or used after it expires
  perform set_config('role', 'authenticated', true);
  begin perform public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'lalamove', 'delivery_quote_id', q->>'quote_id', 'address', 'Blk 1 Lot 2, Dau'));
    report := report || E'\nFAIL  a quote was used twice';
  exception when others then report := report || E'\nPASS  a quote cannot be used twice (' || sqlerrm || ')'; end;
  perform set_config('role', 'service_role', true);
  q2 := public.issue_delivery_quote(customer_id, 15.18, 120.59, 'Mabalacat City', 'x', 4, 8);
  perform set_config('role', 'postgres', true);
  if other_id is not null then
    perform set_config('request.jwt.claim.sub', other_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
    ok := not exists (select 1 from public.delivery_quotes where id = (q2->>'quote_id')::uuid);
    report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  another customer cannot see the quote';
    begin perform public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'lalamove', 'delivery_quote_id', q2->>'quote_id', 'address', 'Blk 1 Lot 2, Dau'));
      report := report || E'\nFAIL  another customer used the quote';
    exception when others then report := report || E'\nPASS  another customer cannot use the quote'; end;
    perform set_config('role', 'postgres', true);
  end if;
  update public.delivery_quotes set expires_at = now() - interval '1 minute' where id = (q2->>'quote_id')::uuid;
  perform set_config('request.jwt.claim.sub', customer_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  begin perform public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'lalamove', 'delivery_quote_id', q2->>'quote_id', 'address', 'Blk 1 Lot 2, Dau'));
    report := report || E'\nFAIL  an expired quote was accepted';
  exception when others then report := report || E'\nPASS  an expired quote is refused (' || sqlerrm || ')'; end;
  ok := exists (select 1 from public.delivery_quotes where id = (q->>'quote_id')::uuid);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  the customer can read their own quote';
  begin update public.delivery_quotes set fee = 1 where id = (q->>'quote_id')::uuid;
    if found then report := report || E'\nFAIL  the customer changed a quote'; else report := report || E'\nPASS  the customer cannot change a quote'; end if;
  exception when others then report := report || E'\nPASS  the customer cannot change a quote'; end;
  begin insert into public.delivery_quotes(customer_id, lat, lng, distance_km, fee, pricing) values (customer_id, 15.1, 120.6, 1, 1, '{}');
    report := report || E'\nFAIL  the customer created their own quote';
  exception when others then report := report || E'\nPASS  the customer cannot create a quote'; end;

  -- 8. store pickup is unaffected while rates are on
  res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'pickup'));
  perform set_config('role', 'postgres', true);
  select * into pick from public.orders where id = (res->>'id')::uuid;
  ok := pick.delivery_fee = 0 and not pick.delivery_in_deposit and pick.delivery_quote_id is null;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  store pickup: no delivery fee';

  -- 9. a later total change (e.g. an accepted additional price) keeps the delivery rule
  -- the same update private.respond_order_extra makes when a customer accepts a ₱50 additional price
  update public.orders set customization_total = customization_total + 50, total_amount = items_subtotal + customization_total + 50 + delivery_fee + rush_fee,
    deposit_due = round((items_subtotal + customization_total + 50 + delivery_fee + rush_fee) * deposit_rate, 2) where id = ord.id;
  select * into ord from public.orders where id = ord.id;
  items := ord.items_subtotal + ord.customization_total + ord.rush_fee; vat := round(items * ord.vat_rate, 2);
  ok := ord.vat_amount = vat and ord.total_amount = items + vat + 155 and ord.deposit_due = round(items * ord.deposit_rate, 2) + vat + 155;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  after a ₱50 additional price: VAT still not on delivery, delivery still all in the downpayment';

  update public.delivery_pricing set enabled = saved_rates.enabled, base_fee = saved_rates.base_fee where id = 1;
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
