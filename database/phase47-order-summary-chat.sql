-- Phase 47: when a customer places an order, the database posts its details into that order's chat, so the
-- customer and LexC's both see exactly what was ordered (items, options, amounts, pickup/delivery, schedule).
--  * One "order_summary" message per order, in the order's own conversation (created if missing).
--  * It is written when the checkout transaction commits, after every order line is saved.
--  * Customers cannot write or edit these messages. Earlier orders are not changed. Safe to re-run.
begin;

-- allow the new message type (keep every type that exists today)
do $$
declare c record; kinds text[];
begin
  select array_agg(distinct k order by k) into kinds from (
    select unnest(array['text','system','payment_proof','payment_verified','payment_rejected','status_update','design_card','order_summary']) k
    union select distinct message_type from public.chat_messages) x;
  for c in select conname from pg_constraint
    where conrelid = 'public.chat_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%message_type%'
      and pg_get_constraintdef(oid) ilike '%payment_proof%'
  loop execute format('alter table public.chat_messages drop constraint %I', c.conname); end loop;
  execute format('alter table public.chat_messages add constraint chat_messages_message_type_check check (message_type = any (%L::text[]))', kinds);
end $$;

create unique index if not exists chat_one_order_summary_per_order on public.chat_messages(order_id) where message_type = 'order_summary';

create or replace function private.chat_order_summary() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders; thread_id uuid; lines jsonb;
begin
  select * into o from public.orders where id = new.id;
  if not found or o.status = 'cancelled' then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', i.name_snapshot, 'option', i.variant_label_snapshot, 'qty', i.quantity, 'total', i.line_total,
      'details', nullif(i.customization->>'summary', ''), 'designed', i.customization ? 'designer') order by i.line_number), '[]'::jsonb)
    into lines from public.order_items i where i.order_id = o.id;
  insert into public.chat_conversations(customer_id, order_id, state) values (o.customer_id, o.id, 'needs_admin')
    on conflict (order_id) where order_id is not null do update set updated_at = now(), state = 'needs_admin'
    returning id into thread_id;
  insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, 'system', 'order_summary',
      'Order #' || o.order_number || ' received. Here is everything you ordered. LexC''s will check it and confirm; payment opens after that.',
      o.id, jsonb_build_object(
        'order_number', o.order_number, 'ordered_at', o.created_at, 'items', lines,
        'items_subtotal', o.items_subtotal, 'customization_total', o.customization_total,
        'delivery_fee', o.delivery_fee, 'delivery_fee_status', o.delivery_fee_status, 'total', o.total_amount,
        'deposit_due', o.deposit_due, 'deposit_rate', o.deposit_rate,
        'fulfillment', o.fulfillment_method, 'receiving_start', o.receiving_start, 'receiving_end', o.receiving_end,
        'name', o.customer_name, 'phone', o.contact_phone, 'address', o.address, 'notes', nullif(btrim(coalesce(o.notes, '')), '')))
    on conflict (order_id) where message_type = 'order_summary' do nothing;
  return null;
end $$;
revoke all on function private.chat_order_summary() from public;
drop trigger if exists chat_order_summary on public.orders;
-- deferred: runs at commit, when the order and all of its lines exist
create constraint trigger chat_order_summary after insert on public.orders
  deferrable initially deferred for each row execute function private.chat_order_summary();

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'chat_order_summary' and tgrelid = 'public.orders'::regclass) then
    raise exception 'Phase 47: trigger missing';
  end if;
end $$;
commit;
