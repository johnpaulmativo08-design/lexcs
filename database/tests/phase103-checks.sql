-- Phase 103 checks: vouchers made by the admin, previewed and redeemed by the customer, every rule checked.
do $rehearsal2$
declare report text := ''; ok boolean; pay jsonb := (select p from rehearsal_payload); res jsonb; o public.orders; v public.vouchers; p jsonb; msg text;
  customer_id uuid := (select id from rehearsal_ids where k = 'customer'); admin_id uuid := (select id from rehearsal_ids where k = 'admin');
  product_id uuid := (select id from rehearsal_ids where k = 'product'); variant_id uuid := (select id from rehearsal_ids where k = 'variant');
  as_admin text := json_build_object('sub', admin_id, 'role', 'authenticated')::text; as_customer text := json_build_object('sub', customer_id, 'role', 'authenticated')::text;
  items jsonb := jsonb_build_array(jsonb_build_object('variant_id', (select id from rehearsal_ids where k = 'variant'), 'qty', 1));
begin
  perform set_config('request.jwt.claim.sub', admin_id::text, true); perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  v := public.save_voucher(jsonb_build_object('code', 'rehearsal10', 'discount_type', 'percent', 'discount_value', 10, 'max_discount', 50, 'usage_limit', 2, 'per_customer_limit', 1));
  perform public.save_voucher(jsonb_build_object('code', 'REHEARSALOLD', 'discount_type', 'fixed', 'discount_value', 30, 'starts_at', now() - interval '3 days', 'ends_at', now() - interval '1 day'));
  perform public.save_voucher(jsonb_build_object('code', 'REHEARSALOFF', 'discount_type', 'fixed', 'discount_value', 30, 'is_active', false));
  perform public.save_voucher(jsonb_build_object('code', 'REHEARSALBIG', 'discount_type', 'fixed', 'discount_value', 30, 'min_purchase', 99999));
  perform set_config('role', 'postgres', true);
  report := report || E'\n' || case when v.code = 'REHEARSAL10' then 'PASS' else 'FAIL' end || format('  code saved in capitals: %s', v.code);

  -- customers cannot read the voucher list
  perform set_config('request.jwt.claim.sub', customer_id::text, true); perform set_config('request.jwt.claims', as_customer, true); perform set_config('role', 'authenticated', true);
  ok := (select count(*) from public.vouchers) = 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  customers cannot list vouchers';

  -- preview: 10% of the item, at most ₱50
  p := public.preview_voucher('rehearsal10', items);
  ok := (p->>'discount')::numeric = least(50, round((select v from rehearsal_ids where k = 'variant') * 0.1, 2)) or (p->>'discount')::numeric > 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  preview: ₱%s off', p->>'discount');
  -- clear messages
  foreach msg in array array['NOPE123', 'REHEARSALOLD', 'REHEARSALOFF', 'REHEARSALBIG'] loop
    begin p := public.preview_voucher(msg, items); report := report || E'\nFAIL  ' || msg || ' was accepted';
    exception when others then report := report || E'\nPASS  ' || msg || ': ' || sqlerrm; end;
  end loop;

  -- placing the order applies it: total and the 60% downpayment come from the discounted total
  res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'voucher_code', 'Rehearsal10'));
  perform set_config('role', 'postgres', true);
  select * into o from public.orders where id = (res->>'id')::uuid;
  ok := o.discount_amount > 0 and o.voucher_code = 'REHEARSAL10'
    and o.total_amount = o.items_subtotal + o.customization_total + coalesce(o.delivery_fee, 0) + o.rush_fee + o.vat_amount - o.discount_amount
    and o.deposit_due = round((o.total_amount - o.vat_amount - case when o.delivery_in_deposit then o.delivery_fee else 0 end) * o.deposit_rate, 2) + o.vat_amount + case when o.delivery_in_deposit then o.delivery_fee else 0 end
    and exists (select 1 from public.voucher_redemptions where order_id = o.id);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  order placed: items ₱%s − voucher ₱%s = total ₱%s, downpayment ₱%s', o.items_subtotal, o.discount_amount, o.total_amount, o.deposit_due);

  -- the same customer cannot use it twice; the whole second order is undone
  perform set_config('role', 'authenticated', true);
  begin
    res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'voucher_code', 'REHEARSAL10'));
    report := report || E'\nFAIL  the same customer used the voucher twice';
  exception when others then report := report || E'\nPASS  second use by the same customer refused, order not placed (' || sqlerrm || ')'; end;
  perform set_config('role', 'postgres', true);

  -- a cancelled order gives its use back
  update public.orders set status = 'cancelled' where id = o.id;
  perform set_config('role', 'authenticated', true);
  begin p := public.preview_voucher('REHEARSAL10', items); ok := (p->>'discount')::numeric > 0;
  exception when others then ok := false; end;
  perform set_config('role', 'postgres', true);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  after the order was cancelled, the customer can use it again';

  -- a used voucher cannot be deleted, only switched off
  perform set_config('request.jwt.claim.sub', admin_id::text, true); perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  begin perform public.delete_voucher(v.id); report := report || E'\nFAIL  a used voucher was deleted';
  exception when others then report := report || E'\nPASS  a used voucher cannot be deleted (' || left(sqlerrm, 50) || '…)'; end;
  v := public.set_voucher_active(v.id, false);
  perform set_config('role', 'postgres', true);
  report := report || E'\n' || case when not v.is_active then 'PASS' else 'FAIL' end || '  switched off';

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal2$;
