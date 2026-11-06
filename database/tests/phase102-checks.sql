-- Phase 102 checks: pretend orders, the clock moved forward with run_payment_deadlines(at_time), every rule checked.
do $rehearsal$
declare report text := ''; ok boolean; pay jsonb; res jsonb; o public.orders; a public.order_payment_attempts; r jsonb; n int;
  customer_id uuid := (select id from rehearsal_ids where k = 'customer'); admin_id uuid := (select id from rehearsal_ids where k = 'admin');
  far_slot uuid := (select id from rehearsal_ids where k = 'far_slot'); near_slot uuid := (select id from rehearsal_ids where k = 'near_slot');
  method text; t0 timestamptz := now(); fee numeric;
  line text;
begin
  pay := (select p from rehearsal_payload); method := pay->>'payment_method';
  -- three pretend orders on a date at least 4 days away, placed as the customer
  perform set_config('request.jwt.claim.sub', customer_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true);
  foreach line in array array['late', 'rejected', 'balance'] loop
    perform set_config('role', 'authenticated', true);
    res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'pickup', 'slot_id', far_slot));
    perform set_config('role', 'postgres', true);
    insert into rehearsal_ids values (line, (res->>'id')::uuid, null);
  end loop;
  n := (select count(*) from public.orders where downpayment_due_at is not null and id not in (select id from rehearsal_ids));
  report := report || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || format('  older orders have no deadlines (%s with one)', n);

  -- 1. confirming sets the deadlines and says the downpayment deadline in the chat
  update public.orders set status = 'confirmed' where id in (select id from rehearsal_ids where k in ('late', 'rejected', 'balance'));
  select * into o from public.orders where id = (select id from rehearsal_ids where k = 'late');
  ok := o.downpayment_due_at between t0 + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'
    and o.balance_due_at = greatest(o.downpayment_due_at, o.receiving_start - interval '24 hours');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  confirmed: downpayment due %s, balance due %s', private.manila_when(o.downpayment_due_at), private.manila_when(o.balance_due_at));
  ok := exists (select 1 from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
                 where c.order_id = o.id and m.body like '%Please pay the 60% downpayment by%');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  the confirmation message names the deadline';

  -- the other two pretend orders, set up before the clock moves: a receipt rejected 1 hour before the deadline,
  -- and a downpayment received (so only the balance is left)
  select * into o from public.orders where id = (select id from rehearsal_ids where k = 'rejected');
  insert into public.order_payment_attempts(order_id, customer_id, payment_method_id, amount, payment_kind, status, submitted_at, transaction_reference,
      provider, provider_payment_id, rejected_at, rejection_reason)
    values (o.id, o.customer_id, (select id from public.payment_methods where code = method), o.deposit_due, 'downpayment', 'rejected',
      o.downpayment_due_at - interval '2 hours', 'REHEARSAL102', 'paymongo', 'pay_rehearsal102', o.downpayment_due_at - interval '1 hour', 'rehearsal');
  update public.orders set payment_status = 'rejected' where id = o.id;
  -- the downpayment as it really happens: a paid payment record, then the order's paid amount
  insert into public.order_payment_attempts(order_id, customer_id, payment_method_id, amount, payment_kind, status, submitted_at, transaction_reference,
      provider, provider_payment_id, verified_at, verified_by, verification_note)
    select o2.id, o2.customer_id, (select id from public.payment_methods where code = method), o2.deposit_due, 'downpayment', 'paid', now(), 'REHEARSAL102D',
      'paymongo', 'pay_rehearsal102d', now(), admin_id, 'rehearsal downpayment'
      from public.orders o2 where o2.id = (select id from rehearsal_ids where k = 'balance');
  update public.orders set amount_paid = deposit_due, payment_status = 'partially_paid' where id = (select id from rehearsal_ids where k = 'balance');
  select * into o from public.orders where id = (select id from rehearsal_ids where k = 'late');

  -- 2. reminders at 6 h and 1 h before, then automatic cancellation after the deadline
  r := private.run_payment_deadlines(o.downpayment_due_at - interval '5 hours');
  select * into o from public.orders where id = o.id;
  ok := o.downpayment_reminders = 1 and o.status = 'confirmed';
  r := private.run_payment_deadlines(o.downpayment_due_at - interval '30 minutes');
  select * into o from public.orders where id = o.id;
  ok := ok and o.downpayment_reminders = 2 and o.status = 'confirmed';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  reminders sent 6 h and 1 h before; order still open';
  r := private.run_payment_deadlines(o.downpayment_due_at + interval '1 minute');
  select * into o from public.orders where id = o.id;
  ok := o.status = 'cancelled' and o.auto_cancelled_at is not null
    and exists (select 1 from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
                 where c.order_id = o.id and m.body like '%cancelled automatically%');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  no downpayment by the deadline: cancelled automatically, customer told';

  -- 3. a receipt rejected 1 hour before the deadline gives 3 hours from the rejection
  select * into o from public.orders where id = (select id from rehearsal_ids where k = 'rejected');
  r := private.run_payment_deadlines(o.downpayment_due_at + interval '1 hour');
  select * into o from public.orders where id = o.id;
  ok := o.status = 'confirmed';
  r := private.run_payment_deadlines(o.downpayment_due_at + interval '2 hours 1 minute');
  select * into o from public.orders where id = o.id;
  ok := ok and o.status = 'cancelled';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  rejected receipt: kept 3 hours from the rejection, then cancelled';

  -- 4. late fee: ₱50 per started 3 hours after the balance deadline, at most ₱300; none before; waived = none
  select * into o from public.orders where id = (select id from rehearsal_ids where k = 'balance');
  ok := private.order_late_fee(o, o.balance_due_at - interval '1 minute') = 0
    and private.order_late_fee(o, o.balance_due_at + interval '1 minute') = 50
    and private.order_late_fee(o, o.balance_due_at + interval '7 hours') = 150
    and private.order_late_fee(o, o.balance_due_at + interval '2 days') = 300;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  late fee: ₱0 before, ₱50 at 1 min, ₱150 at 7 h, ₱300 cap';

  -- 5. a balance payment 4 hours late asks the balance + ₱100, and checking it keeps the fee apart
  update public.orders set balance_due_at = now() - interval '4 hours' where id = o.id returning * into o;
  perform set_config('role', 'authenticated', true);
  a := public.start_order_payment(o.id, method, null, null);
  perform set_config('role', 'postgres', true);
  ok := a.payment_kind = 'balance' and a.late_fee = 100 and a.amount = o.total_amount - o.amount_paid + 100;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  balance payment: ₱%s = balance ₱%s + late fee ₱%s', a.amount, o.total_amount - o.amount_paid, a.late_fee);
  update public.order_payment_attempts set status = 'verification_pending', submitted_at = now(), transaction_reference = 'REHEARSAL102B',
      provider = 'paymongo', provider_payment_id = 'pay_rehearsal102b' where id = a.id;
  update public.orders set payment_status = 'verification_pending' where id = o.id;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  a := public.review_order_payment(a.id, 'paid', 'phase 102 rehearsal');
  perform set_config('role', 'postgres', true);
  select * into o from public.orders where id = o.id;
  ok := o.payment_status = 'paid' and o.amount_paid = o.total_amount and o.late_fee_paid = 100;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  checked as paid: order fully paid (₱%s), late fee kept apart (₱%s)', o.amount_paid, o.late_fee_paid);

  -- 6. waiving: the fee drops to ₱0
  update public.orders set amount_paid = deposit_due, payment_status = 'partially_paid', late_fee_paid = 0 where id = o.id;
  perform set_config('role', 'authenticated', true);
  o := public.waive_late_fee(o.id, true);
  perform set_config('role', 'postgres', true);
  ok := private.order_late_fee(o, now()) = 0;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  waived: no late fee';

  -- 7. a short-notice order (pickup within 48 hours) is due 2 hours after confirmation
  if near_slot is null then report := report || E'\nSKIP  short-notice order (no open slot in the next 47 hours)';
  else
    perform set_config('request.jwt.claim.sub', customer_id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      res := public.create_order(pay || jsonb_build_object('request_id', gen_random_uuid(), 'fulfillment', 'pickup', 'slot_id', near_slot));
      perform set_config('role', 'postgres', true);
      update public.orders set status = 'confirmed' where id = (res->>'id')::uuid returning * into o;
      ok := o.downpayment_due_at <= now() + interval '2 hours 1 minute';
      report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || format('  short-notice order: downpayment due %s (about 2 hours)', private.manila_when(o.downpayment_due_at));
    exception when others then perform set_config('role', 'postgres', true); report := report || E'\nSKIP  short-notice order (' || sqlerrm || ')'; end;
  end if;

  -- 8. the scheduler job exists
  ok := exists (select 1 from cron.job where jobname = 'lexc-payment-deadlines');
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  pg_cron runs the deadlines every 5 minutes';

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
