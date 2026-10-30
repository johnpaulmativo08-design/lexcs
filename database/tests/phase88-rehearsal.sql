-- Phase 88 rehearsal · the customer confirms a Lalamove delivery, WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It shows the chat rule phase 88 replaces, applies phase 88
-- twice (the second run must change nothing), places a pretend delivery order as a real customer, books a pretend
-- rider, then has the customer confirm receipt and checks who may and may not do it. It ends with an error on purpose
-- so nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) ... followed by INFO/PASS/FAIL lines.

create temporary table rehearsal_before on commit drop as
  select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.chat_messages'::regclass and conname = 'chat_messages_check1';

-- ===== phase 88 (run twice) =====
alter table public.order_deliveries add column if not exists received_by_customer boolean not null default false;

-- people may post text; customers and Admin may post pictures; a customer's "I received it" comes only from
-- confirm_order_received below
alter table public.chat_messages drop constraint if exists chat_messages_check1;
alter table public.chat_messages add constraint chat_messages_check1
  check (message_type = 'text' or sender_type = 'system'
         or (message_type = 'image' and sender_type in ('customer', 'admin'))
         or (message_type = 'delivery_update' and sender_type = 'customer'));

create or replace function private.confirm_order_received(target_order uuid)
returns public.order_deliveries language plpgsql security definer set search_path = '' as $$
declare o public.orders; d public.order_deliveries; thread_id uuid;
begin
  if auth.uid() is null then raise exception 'Log in to confirm your order.' using errcode = '42501'; end if;
  select * into o from public.orders where id = target_order and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found.' using errcode = '42501'; end if;
  if o.fulfillment_method <> 'lalamove' then raise exception 'Only delivery orders are confirmed here.' using errcode = '22023'; end if;
  if o.status in ('pending', 'cancelled') then raise exception 'This order is not out for delivery.' using errcode = '22023'; end if;
  select * into d from public.order_deliveries where order_id = o.id for update;
  if not found then raise exception 'LexC''s has not booked your rider yet.' using errcode = '22023'; end if;
  if d.step = 'delivered' then raise exception 'You already confirmed this order. Thank you!' using errcode = '22023'; end if;
  if d.step <> 'booked' and d.step <> 'picked_up' then raise exception 'This delivery did not go through. LexC''s will message you.' using errcode = '22023'; end if;
  update public.order_deliveries
     set step = 'delivered', delivered_at = now(), received_by_customer = true, failed_at = null, failure_reason = null,
         updated_at = now(), updated_by = auth.uid()
   where order_id = o.id returning * into d;
  thread_id := private.order_thread(o);
  insert into public.chat_messages(conversation_id, sender_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, auth.uid(), 'customer', 'delivery_update', 'I received my order #' || o.order_number || '. Thank you!',
            o.id, jsonb_build_object('step', 'delivered', 'received', true));
  update public.chat_conversations set state = 'needs_admin', updated_at = now() where id = thread_id;
  return d;
end $$;
revoke all on function private.confirm_order_received(uuid) from public;
grant execute on function private.confirm_order_received(uuid) to authenticated;
create or replace function public.confirm_order_received(target_order uuid)
returns public.order_deliveries language sql security invoker set search_path = '' as $$
  select private.confirm_order_received(target_order)
$$;
revoke all on function public.confirm_order_received(uuid) from public, anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;

-- second run
alter table public.order_deliveries add column if not exists received_by_customer boolean not null default false;

-- people may post text; customers and Admin may post pictures; a customer's "I received it" comes only from
-- confirm_order_received below
alter table public.chat_messages drop constraint if exists chat_messages_check1;
alter table public.chat_messages add constraint chat_messages_check1
  check (message_type = 'text' or sender_type = 'system'
         or (message_type = 'image' and sender_type in ('customer', 'admin'))
         or (message_type = 'delivery_update' and sender_type = 'customer'));

create or replace function private.confirm_order_received(target_order uuid)
returns public.order_deliveries language plpgsql security definer set search_path = '' as $$
declare o public.orders; d public.order_deliveries; thread_id uuid;
begin
  if auth.uid() is null then raise exception 'Log in to confirm your order.' using errcode = '42501'; end if;
  select * into o from public.orders where id = target_order and customer_id = auth.uid() for update;
  if not found then raise exception 'Order not found.' using errcode = '42501'; end if;
  if o.fulfillment_method <> 'lalamove' then raise exception 'Only delivery orders are confirmed here.' using errcode = '22023'; end if;
  if o.status in ('pending', 'cancelled') then raise exception 'This order is not out for delivery.' using errcode = '22023'; end if;
  select * into d from public.order_deliveries where order_id = o.id for update;
  if not found then raise exception 'LexC''s has not booked your rider yet.' using errcode = '22023'; end if;
  if d.step = 'delivered' then raise exception 'You already confirmed this order. Thank you!' using errcode = '22023'; end if;
  if d.step <> 'booked' and d.step <> 'picked_up' then raise exception 'This delivery did not go through. LexC''s will message you.' using errcode = '22023'; end if;
  update public.order_deliveries
     set step = 'delivered', delivered_at = now(), received_by_customer = true, failed_at = null, failure_reason = null,
         updated_at = now(), updated_by = auth.uid()
   where order_id = o.id returning * into d;
  thread_id := private.order_thread(o);
  insert into public.chat_messages(conversation_id, sender_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, auth.uid(), 'customer', 'delivery_update', 'I received my order #' || o.order_number || '. Thank you!',
            o.id, jsonb_build_object('step', 'delivered', 'received', true));
  update public.chat_conversations set state = 'needs_admin', updated_at = now() where id = thread_id;
  return d;
end $$;
revoke all on function private.confirm_order_received(uuid) from public;
grant execute on function private.confirm_order_received(uuid) to authenticated;
create or replace function public.confirm_order_received(target_order uuid)
returns public.order_deliveries language sql security invoker set search_path = '' as $$
  select private.confirm_order_received(target_order)
$$;
revoke all on function public.confirm_order_received(uuid) from public, anon;
grant execute on function public.confirm_order_received(uuid) to authenticated;


do $rehearsal$
declare
  customer_id uuid; other_id uuid; v public.product_variants; slot_id uuid; method text; res jsonb; ord public.orders; pick public.orders;
  d public.order_deliveries; m public.chat_messages; conv public.chat_conversations; report text := ''; ok boolean;
begin
  report := report || E'\nINFO  chat rule before phase 88: ' || coalesce((select def from rehearsal_before), '(none)');
  select u.id into customer_id from auth.users u join public.profiles pr on pr.id = u.id left join public.user_roles ur on ur.user_id = u.id
   where coalesce(ur.role, 'customer') = 'customer' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
   order by u.created_at limit 1;
  select u.id into other_id from auth.users u join public.profiles pr on pr.id = u.id left join public.user_roles ur on ur.user_id = u.id
   where coalesce(ur.role, 'customer') = 'customer' and u.id <> customer_id order by u.created_at limit 1;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 1 and pr.status = 'active' and pr.kind = 'standard' and (pr.category_id is null or c.is_active) order by pv.price desc limit 1;
  select s.id into slot_id from public.availability_slots s where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity order by s.starts_at limit 1;
  select code into method from public.payment_methods where active and code <> 'paymongo' order by code limit 1;

  -- a delivery order and a pickup order, placed by the customer
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'lalamove',
    'address', 'Blk 1 Lot 2, Rehearsal St., San Roque, Cavite City', 'slot_id', slot_id, 'notes', 'phase 88 rehearsal', 'payment_method', method,
    'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1))));
  select * into ord from public.orders where id = (res->>'id')::uuid;
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'pickup',
    'slot_id', slot_id, 'notes', 'phase 88 rehearsal', 'payment_method', method, 'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1))));
  select * into pick from public.orders where id = (res->>'id')::uuid;

  begin perform public.confirm_order_received(ord.id); report := report || E'\nFAIL  confirmed before a rider was booked';
  exception when others then report := report || E'\nPASS  before a rider is booked: refused (' || sqlerrm || ')'; end;

  -- LexC's confirms and books a pretend rider
  perform set_config('role', 'postgres', true);
  update public.orders set status = 'confirmed' where id in (ord.id, pick.id);
  insert into public.order_deliveries(order_id, step, rider_name, booked_at) values (ord.id, 'booked', 'Rehearsal rider', now());

  -- someone else, a guest, and a pickup order cannot confirm
  if other_id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
    begin perform public.confirm_order_received(ord.id); report := report || E'\nFAIL  another customer could confirm';
    exception when others then report := report || E'\nPASS  another customer cannot confirm'; end;
  end if;
  perform set_config('role', 'anon', true);
  begin perform public.confirm_order_received(ord.id); report := report || E'\nFAIL  a guest could confirm';
  exception when others then report := report || E'\nPASS  guests cannot confirm'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  begin perform public.confirm_order_received(pick.id); report := report || E'\nFAIL  a pickup order could be confirmed';
  exception when others then report := report || E'\nPASS  pickup orders are refused'; end;

  -- the customer confirms
  d := public.confirm_order_received(ord.id);
  perform set_config('role', 'postgres', true);
  ok := d.step = 'delivered' and d.delivered_at is not null and d.received_by_customer and d.updated_by = customer_id;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  delivery marked delivered and received by the customer';
  select * into m from public.chat_messages where order_id = ord.id and message_type = 'delivery_update' order by created_at desc limit 1;
  select * into conv from public.chat_conversations where id = m.conversation_id;
  ok := m.sender_type = 'customer' and m.sender_id = customer_id and m.read_at is null and conv.state = 'needs_admin';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  chat: "' || coalesce(m.body, '(no message)') || '" from the customer, unread, chat needs attention';
  ok := not exists (select 1 from public.chat_messages x where x.conversation_id = m.conversation_id and x.sender_type = 'system' and x.message_type = 'system'
    and (x.body like 'Thanks for%' or x.body like 'Your saved order%' or x.body like 'For a saved order%'));   -- the automatic replies (phase 18)
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  no automatic reply was posted';
  ok := (select status from public.orders where id = ord.id) = 'confirmed';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  order status unchanged (still confirmed; the owner marks completed)';

  perform set_config('role', 'authenticated', true);
  begin perform public.confirm_order_received(ord.id); report := report || E'\nFAIL  confirmed twice';
  exception when others then report := report || E'\nPASS  confirming twice is refused (' || sqlerrm || ')'; end;
  -- customers still cannot post a delivery message directly
  begin insert into public.chat_messages(conversation_id, sender_id, sender_type, message_type, body) values (m.conversation_id, customer_id, 'customer', 'delivery_update', 'x');
    report := report || E'\nFAIL  a customer could post a delivery message directly';
  exception when others then report := report || E'\nPASS  customers cannot post a delivery message directly'; end;
  perform set_config('role', 'postgres', true);

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
