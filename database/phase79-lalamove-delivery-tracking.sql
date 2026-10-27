-- Phase 79 · Lalamove delivery tracking, recorded by hand (Lalamove has no connection to this site).
--
-- Why: when LexC's books a Lalamove rider for a delivery order, the details live only in the Lalamove app. The owner
-- now copies the useful parts into the order, the customer sees them on My Orders and in the order chat, and every
-- delivery keeps a record (who delivered it, when, what Lalamove actually charged).
--
-- What it does:
--   1. New table public.order_deliveries — one row per delivery order:
--        tracking link (the "share" link from the Lalamove app), Lalamove booking ID, rider name, rider phone, plate
--        number, the fee Lalamove charged, a short note, and the delivery step with the time each step was reached:
--          booked → picked up → delivered        (or failed / returned, with a reason)
--      Customers can read only their own order's row; nobody writes the table directly.
--   2. public.save_order_delivery(order, details) — admin only. Saves the details and, when the step changes, stamps
--      its time. Going back a step clears the later times. Only for Lalamove orders that are confirmed and not
--      cancelled. When the step changes (or a tracking link is added while the rider is on the way) a message is
--      posted in the order's chat, so the customer is told.
--   3. Chat messages may have the new type 'delivery_update'.
--
-- What it does NOT do: talk to Lalamove, change order status (marking "Delivered" does not complete the order — the
-- balance may still be unpaid; use Mark completed as before), payments, prices, inventory, or any existing order.
--
-- How to apply: rehearse with database/tests/phase79-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor.

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

notify pgrst, 'reload schema';
