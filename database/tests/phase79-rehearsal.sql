-- Phase 79 rehearsal · tests Lalamove delivery tracking on the real database WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 79, places a pretend delivery order as a
-- customer, then as the admin walks it through booked → picked up → delivered (and back), checking the times, the
-- chat messages, the input checks and who can read or write the details. It ends with an error on purpose: that
-- cancels the whole transaction, so nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 79 =====
create table if not exists public.order_deliveries (
  order_id uuid primary key references public.orders(id) on delete cascade,
  step text not null default 'booked' check (step in ('booked','picked_up','delivered','failed')),
  tracking_url text check (tracking_url is null or (tracking_url ~ '^https://[^[:space:]<>"'']+$' and length(tracking_url) <= 500)),
  booking_ref text check (booking_ref is null or length(booking_ref) <= 40),
  rider_name text check (rider_name is null or length(rider_name) <= 80),
  rider_phone text check (rider_phone is null or rider_phone ~ '^\+?[0-9 ]{7,20}$'),
  plate_number text check (plate_number is null or length(plate_number) <= 15),
  fee_charged numeric(10,2) check (fee_charged is null or (fee_charged >= 0 and fee_charged <= 99999)),
  note text check (note is null or length(note) <= 300),
  failure_reason text check (failure_reason is null or length(failure_reason) <= 300),
  booked_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.order_deliveries enable row level security;
revoke all on public.order_deliveries from anon, authenticated;
grant select on public.order_deliveries to authenticated;
drop policy if exists order_deliveries_read on public.order_deliveries;
create policy order_deliveries_read on public.order_deliveries for select to authenticated
  using (private.is_admin() or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));

-- allow the new chat message type (keep every type that exists today)
do $$
declare c record; kinds text[];
begin
  select array_agg(distinct k order by k) into kinds from (
    select unnest(array['text','system','payment_proof','payment_verified','payment_rejected','status_update','design_card','order_summary','price_review','image','delivery_update']) k
    union select distinct message_type from public.chat_messages) x;
  for c in select conname from pg_constraint
    where conrelid = 'public.chat_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%message_type%' and pg_get_constraintdef(oid) ilike '%payment_proof%'
  loop execute format('alter table public.chat_messages drop constraint %I', c.conname); end loop;
  execute format('alter table public.chat_messages add constraint chat_messages_message_type_check check (message_type = any (%L::text[]))', kinds);
end $$;

create or replace function private.save_order_delivery(target_order uuid, details jsonb)
returns public.order_deliveries language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; d public.order_deliveries; before public.order_deliveries; had boolean;
  next_step text := nullif(btrim(coalesce(details->>'step', '')), ''); thread_id uuid; said text;
  clean_phone text := nullif(regexp_replace(btrim(coalesce(details->>'rider_phone', '')), '[^0-9+ ]', '', 'g'), '');
  rank_of jsonb := '{"booked":1,"picked_up":2,"delivered":3,"failed":3}';
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  select * into o from public.orders where id = target_order for update;
  if not found then raise exception 'Order not found.' using errcode = '22023'; end if;
  if o.fulfillment_method <> 'lalamove' then raise exception 'Only delivery orders have Lalamove details.' using errcode = '22023'; end if;
  if o.status in ('pending','cancelled') then raise exception 'Confirm the order before booking a rider.' using errcode = '22023'; end if;
  if next_step is not null and next_step not in ('booked','picked_up','delivered','failed') then
    raise exception 'Unknown delivery step.' using errcode = '22023';
  end if;
  if next_step = 'failed' and nullif(btrim(coalesce(details->>'failure_reason', '')), '') is null then
    raise exception 'Write what happened so the record is clear (for example: customer not home, returned to LexC''s).' using errcode = '22023';
  end if;
  select * into before from public.order_deliveries where order_id = o.id for update;
  had := found;
  insert into public.order_deliveries as x (order_id, step, tracking_url, booking_ref, rider_name, rider_phone, plate_number, fee_charged, note,
      failure_reason, booked_at, updated_at, updated_by)
    values (o.id, coalesce(next_step, 'booked'),
      nullif(btrim(coalesce(details->>'tracking_url', '')), ''), nullif(btrim(coalesce(details->>'booking_ref', '')), ''),
      nullif(btrim(coalesce(details->>'rider_name', '')), ''), clean_phone,
      upper(nullif(btrim(coalesce(details->>'plate_number', '')), '')), nullif(details->>'fee_charged', '')::numeric,
      nullif(btrim(coalesce(details->>'note', '')), ''), nullif(btrim(coalesce(details->>'failure_reason', '')), ''),
      now(), now(), auth.uid())
  on conflict (order_id) do update set
    step = coalesce(next_step, x.step),
    tracking_url = excluded.tracking_url, booking_ref = excluded.booking_ref, rider_name = excluded.rider_name,
    rider_phone = excluded.rider_phone, plate_number = excluded.plate_number, fee_charged = excluded.fee_charged,
    note = excluded.note, failure_reason = case when coalesce(next_step, x.step) = 'failed' then excluded.failure_reason else null end,
    updated_at = now(), updated_by = auth.uid()
  returning * into d;
  -- each step keeps the time it was first reached; going back a step clears the later ones
  update public.order_deliveries set
    booked_at = coalesce(booked_at, now()),
    picked_up_at = case when (rank_of->>d.step)::int >= 2 and d.step <> 'failed' then coalesce(picked_up_at, now()) when d.step = 'failed' then picked_up_at else null end,
    delivered_at = case when d.step = 'delivered' then coalesce(delivered_at, now()) else null end,
    failed_at = case when d.step = 'failed' then coalesce(failed_at, now()) else null end
  where order_id = o.id returning * into d;
  -- tell the customer in the order chat when the step changes, or when a tracking link arrives while on the way
  said := case
    when not had or before.step is distinct from d.step then
      case d.step when 'booked' then 'A Lalamove rider is booked for your order.'
                  when 'picked_up' then 'Your order is on the way with Lalamove.'
                  when 'delivered' then 'Your order was delivered. Enjoy your treats!'
                  else 'The delivery did not go through: ' || d.failure_reason || ' LexC''s will message you here.' end
    when d.tracking_url is not null and before.tracking_url is distinct from d.tracking_url and d.step in ('booked','picked_up') then
      'You can now follow your rider live on Lalamove.'
  end;
  if said is not null then
    thread_id := private.order_thread(o);
    insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id, attachments)
      values (thread_id, 'system', 'delivery_update', said, o.id, jsonb_build_object('step', d.step));
    update public.chat_conversations set updated_at = now() where id = thread_id;
  end if;
  return d;
end $$;
revoke all on function private.save_order_delivery(uuid, jsonb) from public;
grant execute on function private.save_order_delivery(uuid, jsonb) to authenticated;
create or replace function public.save_order_delivery(target_order uuid, details jsonb)
returns public.order_deliveries language sql security invoker set search_path = '' as $$
  select private.save_order_delivery(target_order, details)
$$;
revoke all on function public.save_order_delivery(uuid, jsonb) from public;
grant execute on function public.save_order_delivery(uuid, jsonb) to authenticated;


do $rehearsal$
declare
  admin_id uuid; customer_id uuid; v public.product_variants; slot_id uuid; res jsonb; ord public.orders; d public.order_deliveries;
  report text := ''; ok boolean; method text; n int;
  as_admin text; as_customer text;
begin
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' limit 1;
  select u.id into customer_id from auth.users u join public.profiles p on p.id = u.id left join public.user_roles r on r.user_id = u.id
   where coalesce(r.role, 'customer') = 'customer' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
   order by u.created_at limit 1;
  as_admin := json_build_object('sub', admin_id, 'role', 'authenticated')::text;
  as_customer := json_build_object('sub', customer_id, 'role', 'authenticated')::text;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id
   left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 1 and pr.status = 'active' and pr.kind = 'standard' and (pr.category_id is null or c.is_active)
   order by pv.price desc limit 1;
  select s.id into slot_id from public.availability_slots s
   where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity
   order by s.starts_at limit 1;
  select pm.code into method from public.payment_methods pm where pm.active order by pm.code limit 1;
  if slot_id is null or v.id is null then raise exception 'REHEARSAL could not place a pretend order.'; end if;

  perform set_config('request.jwt.claims', as_customer, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'lalamove',
    'address', 'Blk 1 Lot 2, Dau, Mabalacat, Pampanga', 'slot_id', slot_id, 'notes', 'phase 79 rehearsal', 'payment_method', method,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1))));
  perform set_config('role', 'postgres', true);
  select * into ord from public.orders where id = (res->>'id')::uuid;
  report := report || E'\nINFO  pretend delivery order #' || ord.order_number || ' (' || ord.fulfillment_method || ', ' || ord.status || ')';

  -- before confirming
  perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  begin perform public.save_order_delivery(ord.id, '{}'); report := report || E'\nFAIL  pending order accepted a rider';
  exception when others then report := report || E'\nPASS  pending order refused: ' || sqlerrm; end;
  perform set_config('role', 'postgres', true);
  update public.orders set status = 'confirmed' where id = ord.id;

  -- a customer cannot save details
  perform set_config('request.jwt.claims', as_customer, true); perform set_config('role', 'authenticated', true);
  begin perform public.save_order_delivery(ord.id, '{}'); report := report || E'\nFAIL  customer could save delivery details';
  exception when others then report := report || E'\nPASS  customer refused: ' || sqlerrm; end;
  begin insert into public.order_deliveries(order_id) values (ord.id); report := report || E'\nFAIL  customer wrote the table directly';
  exception when others then report := report || E'\nPASS  direct write refused'; end;
  perform set_config('role', 'postgres', true);

  -- booked
  perform set_config('request.jwt.claims', as_admin, true); perform set_config('role', 'authenticated', true);
  d := public.save_order_delivery(ord.id, jsonb_build_object('step', 'booked', 'booking_ref', '1234567890', 'rider_name', 'Mark D.', 'rider_phone', '0917-123-4567', 'plate_number', 'nab 1234', 'fee_charged', '165'));
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.chat_messages where order_id = ord.id and message_type = 'delivery_update';
  ok := d.step = 'booked' and d.booked_at is not null and d.picked_up_at is null and d.rider_phone = '09171234567' and d.plate_number = 'NAB 1234' and d.fee_charged = 165 and n = 1;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  booked: phone ' || coalesce(d.rider_phone, '-') || ', plate ' || coalesce(d.plate_number, '-') || ', chat messages ' || n;

  -- tracking link added later, same step
  perform set_config('role', 'authenticated', true);
  d := public.save_order_delivery(ord.id, jsonb_build_object('booking_ref', '1234567890', 'rider_name', 'Mark D.', 'rider_phone', '09171234567', 'plate_number', 'NAB 1234', 'fee_charged', '165', 'tracking_url', 'https://share.lalamove.com/abc123'));
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.chat_messages where order_id = ord.id and message_type = 'delivery_update';
  ok := d.step = 'booked' and d.tracking_url is not null and n = 2;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  tracking link added: customer told (messages ' || n || ')';

  -- bad input
  perform set_config('role', 'authenticated', true);
  begin perform public.save_order_delivery(ord.id, jsonb_build_object('tracking_url', 'javascript:alert(1)')); report := report || E'\nFAIL  unsafe link accepted';
  exception when others then report := report || E'\nPASS  unsafe link refused'; end;
  begin perform public.save_order_delivery(ord.id, jsonb_build_object('rider_phone', 'call me')); report := report || E'\nFAIL  bad phone accepted';
  exception when others then report := report || E'\nPASS  bad phone refused'; end;
  begin perform public.save_order_delivery(ord.id, jsonb_build_object('step', 'failed')); report := report || E'\nFAIL  failed without a reason accepted';
  exception when others then report := report || E'\nPASS  failed needs a reason'; end;

  -- picked up, delivered, then back
  d := public.save_order_delivery(ord.id, jsonb_build_object('step', 'picked_up', 'tracking_url', 'https://share.lalamove.com/abc123', 'rider_name', 'Mark D.'));
  ok := d.step = 'picked_up' and d.picked_up_at is not null and d.booking_ref is null;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  picked up (fields not sent are cleared, as the form always sends them all)';
  d := public.save_order_delivery(ord.id, jsonb_build_object('step', 'delivered', 'tracking_url', 'https://share.lalamove.com/abc123', 'rider_name', 'Mark D.'));
  ok := d.step = 'delivered' and d.delivered_at is not null and d.picked_up_at is not null;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  delivered at ' || d.delivered_at;
  d := public.save_order_delivery(ord.id, jsonb_build_object('step', 'picked_up', 'tracking_url', 'https://share.lalamove.com/abc123', 'rider_name', 'Mark D.'));
  ok := d.step = 'picked_up' and d.delivered_at is null;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  undo to picked up clears the delivered time';
  d := public.save_order_delivery(ord.id, jsonb_build_object('step', 'failed', 'failure_reason', 'Customer not home; returned to LexC''s.'));
  ok := d.step = 'failed' and d.failed_at is not null and d.failure_reason is not null;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  failed / returned with a reason';
  perform set_config('role', 'postgres', true);
  select status into ord.status from public.orders where id = ord.id;
  report := report || E'\n' || case when ord.status = 'confirmed' then 'PASS' else 'FAIL' end || '  order status untouched (' || ord.status || ')';
  select count(*) into n from public.chat_messages where order_id = ord.id and message_type = 'delivery_update';
  report := report || E'\n' || case when n = 6 then 'PASS' else 'FAIL' end || '  chat messages for the steps: ' || n;

  -- who can read it
  perform set_config('request.jwt.claims', as_customer, true); perform set_config('role', 'authenticated', true);
  select count(*) into n from public.order_deliveries where order_id = ord.id;
  report := report || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  the customer reads their own delivery (' || n || ')';
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  select count(*) into n from public.order_deliveries where order_id = ord.id;
  report := report || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  another account sees nothing (' || n || ')';
  perform set_config('role', 'anon', true);
  begin select count(*) into n from public.order_deliveries; report := report || E'\nFAIL  signed-out visitor could read deliveries';
  exception when others then report := report || E'\nPASS  signed-out visitor refused'; end;
  perform set_config('role', 'postgres', true);

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
