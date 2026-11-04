-- Phase 95 checks (after the migration in phase95-rehearsal.sql). Builds pretend orders BEFORE the migration runs
-- (see the "setup" block in the rehearsal), then checks them. Ends with an error on purpose: nothing is saved.
do $rehearsal$
declare report text := ''; ok boolean; o public.orders; a public.order_payment_attempts; res jsonb; customer_id uuid; pay jsonb;
begin
  -- 1. an order nobody paid yet: VAT removed, downpayment recalculated
  select * into o from public.orders where id = (select id from rehearsal_ids where k = 'unpaid');
  ok := o.vat_amount = 0 and o.vat_rate = 0 and o.total_amount = o.items_subtotal + o.customization_total + o.delivery_fee + o.rush_fee
    and o.deposit_due = round((o.total_amount - case when o.delivery_in_deposit then o.delivery_fee else 0 end) * o.deposit_rate, 2) + case when o.delivery_in_deposit then o.delivery_fee else 0 end;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  unpaid order: VAT ₱%s, total ₱%s, downpayment ₱%s', o.vat_amount, o.total_amount, o.deposit_due);
  ok := (select order_total from public.booking_entries where order_id = o.id) = o.total_amount;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  the reservation record shows the new total';

  -- 2. a prepared payment (nothing sent) asks for the new amount
  select * into o from public.orders where id = (select id from rehearsal_ids where k = 'prepared');
  select * into a from public.order_payment_attempts where order_id = o.id and status = 'awaiting_payment';
  ok := o.vat_amount = 0 and a.amount = o.deposit_due;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  prepared payment: now asks ₱%s (downpayment ₱%s)', a.amount, o.deposit_due);

  -- 3. an order with a receipt being checked keeps its amounts
  select * into o from public.orders where id = (select id from rehearsal_ids where k = 'checking');
  ok := o.vat_amount > 0 and o.total_amount = (select v from rehearsal_ids where k = 'checking');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  receipt being checked: unchanged (VAT ₱%s kept)', o.vat_amount);

  -- 4. new orders: no VAT
  customer_id := (select id from rehearsal_ids where k = 'customer');
  pay := (select p from rehearsal_payload);   -- read before switching to the customer role
  perform set_config('request.jwt.claim.sub', customer_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'pickup'));
  perform set_config('role', 'postgres', true);
  select * into o from public.orders where id = (res->>'id')::uuid;
  ok := o.vat_rate = 0 and o.vat_amount = 0 and o.total_amount = o.items_subtotal + o.customization_total + o.rush_fee and o.deposit_due = round(o.total_amount * o.deposit_rate, 2);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  new order: VAT ₱%s, total ₱%s, downpayment ₱%s (60%%)', o.vat_amount, o.total_amount, o.deposit_due);

  -- 5. "different amount" is refused; downpayment and full still work
  update public.orders set status = 'confirmed' where id = o.id;
  perform set_config('role', 'authenticated', true);
  begin perform public.start_order_payment(o.id, (select code from public.payment_methods where active and code <> 'paymongo' order by code limit 1), 'custom', 10);
    report := report || E'\nFAIL  a custom amount was accepted';
  exception when others then report := report || E'\nPASS  a custom amount is refused (' || sqlerrm || ')'; end;
  a := public.start_order_payment(o.id, (select code from public.payment_methods where active and code <> 'paymongo' order by code limit 1), 'downpayment', null);
  ok := a.amount = o.deposit_due;
  a := public.start_order_payment(o.id, (select code from public.payment_methods where active and code <> 'paymongo' order by code limit 1), 'full', null);
  ok := ok and a.amount = o.total_amount;
  perform set_config('role', 'postgres', true);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  downpayment and full payment still work';

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
