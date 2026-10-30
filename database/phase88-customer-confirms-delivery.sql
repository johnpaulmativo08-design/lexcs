-- Phase 88 · The customer confirms they received a Lalamove delivery.
--
-- Why: LexC's books the rider, but only the customer knows when the treats actually arrived. Instead of the owner
-- tapping "Picked up" and "Delivered", the customer taps "I received my order" (My Purchases → To receive, or the
-- delivery card on My Orders). LexC's is told in the order's chat.
--
-- What it does:
--   1. order_deliveries gets received_by_customer (true once the customer confirms).
--   2. public.confirm_order_received(order) — the signed-in customer, for their own Lalamove order whose rider is
--      booked (or on the way): marks the delivery Delivered (delivered_at = now) and posts "I received my order #…"
--      in the order chat as a message from the customer, so it shows as unread for LexC's and the chat moves to
--      Needs attention. Confirming twice, someone else's order, a pickup order, or an order without a booked rider
--      is refused.
--   3. Chat messages may be a customer "delivery_update" (only this function writes one; customers still post plain
--      text and pictures as before, and the automatic reply does not answer it).
--
-- What it does NOT do: change order status (the owner still taps Mark completed), payments, prices, inventory,
-- the admin save_order_delivery function, or any existing row.
--
-- How to apply: rehearse with database/tests/phase88-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to re-run.

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

notify pgrst, 'reload schema';
