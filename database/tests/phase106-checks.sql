-- Phase 106 checks: the fee table, two days' notice for customers, and the fee on a real order.
do $rehearsal$
declare report text := ''; ok boolean; pay jsonb := (select p from rehearsal_payload); res jsonb; o public.orders; d integer; s uuid;
  customer_id uuid := (select id from rehearsal_ids where k = 'customer'); slots uuid[] := array[pg_temp.slot_in(0), pg_temp.slot_in(1), pg_temp.slot_in(2), pg_temp.slot_in(3), null, null, pg_temp.slot_in(6)]; admin_id uuid := (select id from rehearsal_ids where k = 'admin');
begin
  foreach d in array array[2, 3, 4, 5, 9] loop
    report := report || E'\n' || case when private.rush_fee_for((now() at time zone 'Asia/Manila')::date + d) = case when d <= 2 then 400 when d <= 4 then 200 else 0 end then 'PASS' else 'FAIL' end
      || format('  %s days ahead → rush fee ₱%s', d, private.rush_fee_for((now() at time zone 'Asia/Manila')::date + d));
  end loop;

  perform set_config('request.jwt.claim.sub', customer_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  foreach d in array array[0, 1] loop
    s := slots[d + 1];
    if s is null then report := report || format(E'\nSKIP  no open slot %s day(s) ahead to try', d); continue; end if;
    begin
      res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'slot_id', s));
      report := report || format(E'\nFAIL  a customer ordered %s day(s) ahead', d);
    exception when others then report := report || format(E'\nPASS  %s day(s) ahead refused: %s', d, sqlerrm); end;
  end loop;

  foreach d in array array[2, 3, 6] loop
    s := slots[d + 1];
    if s is null then report := report || format(E'\nSKIP  no open slot %s days ahead to try', d); continue; end if;
    res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'slot_id', s));
    perform set_config('role', 'postgres', true);
    select * into o from public.orders where id = (res->>'id')::uuid;
    ok := o.rush_fee = case when d <= 2 then 400 when d <= 4 then 200 else 0 end
      and o.total_amount = o.items_subtotal + o.customization_total + coalesce(o.delivery_fee, 0) + o.rush_fee + o.vat_amount - coalesce(o.discount_amount, 0);
    report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  order %s days ahead: rush ₱%s, items ₱%s, total ₱%s, downpayment ₱%s', d, o.rush_fee, o.items_subtotal, o.total_amount, o.deposit_due);
    perform set_config('role', 'authenticated', true);
  end loop;

  perform set_config('role', 'postgres', true);
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
