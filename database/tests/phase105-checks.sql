-- Phase 105 checks: only shown vouchers are listed, with the cart fit worked out; only the admin can show them.
do $rehearsal$
declare report text := ''; ok boolean; list jsonb; v public.vouchers; hidden public.vouchers; big public.vouchers;
  customer_id uuid := (select id from rehearsal_ids where k = 'customer'); admin_id uuid := (select id from rehearsal_ids where k = 'admin');
  items jsonb := jsonb_build_array(jsonb_build_object('variant_id', (select id from rehearsal_ids where k = 'variant'), 'qty', 1));
begin
  perform set_config('request.jwt.claim.sub', admin_id::text, true); perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  v := public.save_voucher(jsonb_build_object('code', 'REHEARSALSHOW', 'discount_type', 'fixed', 'discount_value', 20));
  hidden := public.save_voucher(jsonb_build_object('code', 'REHEARSALHIDE', 'discount_type', 'fixed', 'discount_value', 20));
  big := public.save_voucher(jsonb_build_object('code', 'REHEARSALMIN', 'discount_type', 'fixed', 'discount_value', 20, 'min_purchase', 99999));
  v := public.set_voucher_shown(v.id, true); perform public.set_voucher_shown(big.id, true);
  report := report || E'\n' || case when v.show_to_customers then 'PASS' else 'FAIL' end || '  admin can show a voucher';

  perform set_config('request.jwt.claim.sub', customer_id::text, true); perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true);
  begin perform public.set_voucher_shown(hidden.id, true); report := report || E'\nFAIL  a customer could show a voucher';
  exception when others then report := report || E'\nPASS  customers cannot show vouchers (' || sqlerrm || ')'; end;
  list := public.available_vouchers(items);
  ok := exists (select 1 from jsonb_array_elements(list) x where x->>'code' = 'REHEARSALSHOW' and (x->>'fits')::boolean and (x->>'discount')::numeric = 20)
    and not exists (select 1 from jsonb_array_elements(list) x where x->>'code' = 'REHEARSALHIDE');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  shown voucher listed and fits the cart; hidden one not listed';
  ok := exists (select 1 from jsonb_array_elements(list) x where x->>'code' = 'REHEARSALMIN' and not (x->>'fits')::boolean and x->>'reason' like '%minimum%');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  voucher above the cart minimum listed as not fitting, with the reason';
  list := public.available_vouchers();
  report := report || E'\n' || case when jsonb_array_length(list) >= 2 then 'PASS' else 'FAIL' end || '  works without cart items';

  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true); perform set_config('role', 'anon', true);
  begin list := public.available_vouchers(); report := report || E'\nFAIL  visitors (not logged in) could call it';
  exception when others then report := report || E'\nPASS  visitors cannot call it'; end;
  perform set_config('role', 'postgres', true);
  raise exception 'REHEARSAL REPORT (nothing was saved)%', report;
end $rehearsal$;
