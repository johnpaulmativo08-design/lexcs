-- Phase 107 checks: placing and confirming an order queues the right emails; only the server can take them.
do $rehearsal$
declare report text := ''; ok boolean; pay jsonb := (select p from rehearsal_payload); res jsonb; o public.orders; s uuid := pg_temp.slot_in(6); got jsonb; kinds text;
  customer_id uuid := (select id from rehearsal_ids where k = 'customer'); admin_id uuid := (select id from rehearsal_ids where k = 'admin');
begin
  if s is null then s := pg_temp.slot_in(7); end if;
  perform set_config('request.jwt.claim.sub', customer_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'slot_id', s));
  -- a customer cannot read or take the queue
  begin got := public.email_outbox_claim(); report := report || E'\nFAIL  a customer could take emails from the queue';
  exception when others then report := report || E'\nPASS  customers cannot take emails (' || left(sqlerrm, 60) || ')'; end;
  begin perform count(*) from private.email_outbox; report := report || E'\nFAIL  a customer could read the email queue';
  exception when others then report := report || E'\nPASS  customers cannot read the email queue'; end;
  perform set_config('role', 'postgres', true);
  select * into o from public.orders where id = (res->>'id')::uuid;
  select string_agg(recipient || ':' || kind, ', ' order by id) into kinds from private.email_outbox where order_id = o.id;
  report := report || E'\n' || case when kinds = 'admin:order_new, customer:order_received' then 'PASS' else 'FAIL' end || '  new order queues: ' || coalesce(kinds, 'nothing');

  update public.orders set status = 'confirmed' where id = o.id;
  select string_agg(kind, ', ' order by id) into kinds from private.email_outbox where order_id = o.id and kind like 'order_c%';
  report := report || E'\n' || case when kinds = 'order_confirmed' then 'PASS' else 'FAIL' end || '  confirming queues: ' || coalesce(kinds, 'nothing');
  update public.orders set status = 'confirmed' where id = o.id;   -- same status again: no second email
  ok := (select count(*) from private.email_outbox where order_id = o.id and kind = 'order_confirmed') = 1;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  saving without a status change sends nothing new';

  -- the server's view: subject, text and the customer's address
  perform set_config('role', 'service_role', true);
  got := public.email_outbox_claim();
  ok := exists (select 1 from jsonb_array_elements(got) x where x->>'recipient' = 'customer' and (x->>'subject') like '%confirmed%' and x->>'to' like '%@%');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  server takes %s waiting email(s); customer address found', jsonb_array_length(got));
  perform public.email_outbox_done(array(select (x->>'id')::bigint from jsonb_array_elements(got) x), '{}'::jsonb);
  perform set_config('role', 'postgres', true);
  ok := not exists (select 1 from private.email_outbox where order_id = o.id and sent_at is null);
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  reported emails are marked sent';
  report := report || E'\n' || case when exists (select 1 from cron.job where jobname = 'lexc-send-email') then 'PASS' else 'FAIL' end || '  the every-minute sender job is scheduled';
  report := report || E'\nINFO  sample: ' || (select subject || ' — ' || left(replace(body, E'\n', ' / '), 160) from private.email_outbox where order_id = o.id and kind = 'order_confirmed');
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
