-- Phase 95 setup (runs BEFORE the migration in phase95-rehearsal.sql): three pretend orders that still have VAT.
create temp table rehearsal_ids(k text primary key, id uuid, v numeric);
create temp table rehearsal_payload(p jsonb);
do $setup$
declare customer_id uuid; v public.product_variants; slot_id uuid; method text; res jsonb; pay jsonb; ord public.orders; a public.order_payment_attempts; prepared_id uuid; checking_id uuid;
begin
  select ur.user_id into customer_id from public.user_roles ur where ur.role = 'customer' order by ur.created_at limit 1;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 1 and pr.status = 'active' and pr.kind = 'standard' and not coalesce(pr.is_test_product, false)
     and (pr.category_id is null or c.is_active) order by pv.price desc limit 1;
  select s.id into slot_id from public.availability_slots s where s.is_open and s.starts_at > now() + interval '3 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity order by s.starts_at limit 1;
  select code into method from public.payment_methods where active and code <> 'paymongo' order by code limit 1;
  pay := jsonb_build_object('name', 'Rehearsal', 'phone', '09171234567', 'slot_id', slot_id, 'notes', 'phase 95 rehearsal', 'payment_method', method,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1)));
  insert into rehearsal_payload values (pay);
  insert into rehearsal_ids values ('customer', customer_id, null);
  perform set_config('request.jwt.claim.sub', customer_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true);
  -- orders placed while VAT was still on (the old default)
  alter table public.orders alter column vat_rate set default 0.12;
  foreach method in array array['unpaid', 'prepared', 'checking'] loop
    perform set_config('role', 'authenticated', true);
    res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'pickup'));
    perform set_config('role', 'postgres', true);
    select * into ord from public.orders where id = (res->>'id')::uuid;
    insert into rehearsal_ids values (method, ord.id, ord.total_amount);
  end loop;
  update public.orders set status = 'confirmed' where id in (select id from rehearsal_ids where k in ('prepared', 'checking'));
  select id into prepared_id from rehearsal_ids where k = 'prepared'; select id into checking_id from rehearsal_ids where k = 'checking';
  perform set_config('role', 'authenticated', true);
  perform public.start_order_payment(prepared_id, pay->>'payment_method', 'downpayment', null);
  a := public.start_order_payment(checking_id, pay->>'payment_method', 'downpayment', null);
  perform set_config('role', 'postgres', true);
  update public.order_payment_attempts set status = 'verification_pending', submitted_at = now(), transaction_reference = '1234567890',
    proof_storage_path = 'rehearsal/receipt.jpg' where id = a.id;
end $setup$;
-- fire the checks that normally wait for the end of the transaction, so the migration can alter the table
set constraints all immediate;
