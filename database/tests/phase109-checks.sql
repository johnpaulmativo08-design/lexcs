-- Phase 109 checks: own addresses only; 4th cancellation of the day pauses ordering for 8 hours; 9 PM slots exist.
do $rehearsal$
declare report text := ''; ok boolean; pay jsonb := (select p from rehearsal_payload); res jsonb; r jsonb; n integer; ids uuid[] := '{}'; s uuid; prior integer;
  cust uuid := (select id from rehearsal_ids where k = 'customer'); other_id uuid := (select id from rehearsal_ids where k = 'other');
  late uuid := pg_temp.slot_at(12, 21); days uuid[] := array[pg_temp.slot_at(13, 10), pg_temp.slot_at(14, 10), pg_temp.slot_at(15, 10), pg_temp.slot_at(16, 10), pg_temp.slot_at(17, 10)];
begin
  report := report || E'\n' || case when late is not null then 'PASS' else 'FAIL' end || '  a 9 PM receiving slot exists 12 days ahead';
  select count(*) into prior from public.order_cancellations c where c.customer_id = cust
     and c.created_at >= ((now() at time zone 'Asia/Manila')::date)::timestamp at time zone 'Asia/Manila';
  delete from public.customer_order_pauses p where p.customer_id = cust;   -- start clean (rolled back)

  perform set_config('request.jwt.claim.sub', cust::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.customer_addresses (recipient, phone, address, lat, lng, is_default) values ('Rehearsal', '09171234567', '66 Quezon St., Dau, Mabalacat', 15.17, 120.58, true);
  report := report || E'\n' || case when (select count(*) from public.customer_addresses where recipient = 'Rehearsal') = 1 then 'PASS' else 'FAIL' end || '  customer saves and reads their own address';

  -- the 9 PM slot takes an order
  res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'slot_id', late));
  ids := ids || (res->>'id')::uuid;
  report := report || E'\nPASS  order placed for 9 PM';
  foreach s in array days loop
    exit when array_length(ids, 1) >= greatest(1, 4 - prior);
    res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'slot_id', s)); ids := ids || (res->>'id')::uuid;
  end loop;
  -- cancel until the 4th of the day
  begin r := public.cancel_my_order_with_reason(ids[1], ''); report := report || E'\nFAIL  cancelled without a reason';
  exception when others then report := report || E'\nPASS  a reason is required (' || sqlerrm || ')'; end;
  n := 0;
  foreach s in array ids loop
    r := public.cancel_my_order_with_reason(s, 'Changed my mind');
    n := n + 1;
    report := report || format(E'\nINFO  cancellation %s today → paused until %s', r->>'cancellations_today', coalesce(r->>'paused_until', '—'));
    exit when (r->>'cancellations_today')::integer >= 4;
  end loop;
  ok := (r->>'cancellations_today')::integer >= 4 and r->>'paused_until' is not null;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  the 4th cancellation of the day pauses ordering for 8 hours';
  begin res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'slot_id', days[5]));
    report := report || E'\nFAIL  ordered while paused';
  exception when others then report := report || E'\nPASS  new order refused while paused: ' || sqlerrm; end;

  -- someone else cannot see these addresses or cancellations
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  ok := (select count(*) from public.customer_addresses where recipient = 'Rehearsal') = 0 and (select count(*) from public.order_cancellations where order_id = any(ids)) = 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  another customer sees none of it';
  perform set_config('role', 'postgres', true);
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
