-- Phase 53: one chat per order. The DIY design card used to go to the customer's general chat while the order summary
-- went to the order's own chat, so one custom order showed up as two conversations. From now on the design card is
-- posted in the order's chat, existing cards are moved there, general chats that held nothing but those cards are
-- removed (they have no other messages), and order summaries show the order's current total. Safe to re-run.
begin;

-- 1. new orders: the design card goes to the order's own chat
create or replace function private.chat_design_card() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders; thread_id uuid; entry jsonb; kind text := new.customization->>'designer';
begin
  if new.customization is null or kind is null or kind not in ('bento', 'cupcake', 'donut', 'cakepop') then return new; end if;
  select * into o from public.orders where id = new.order_id;
  if not found then return new; end if;
  thread_id := private.order_thread(o);
  entry := jsonb_build_object('line', new.line_number, 'name', new.name_snapshot, 'variant_id', new.variant_id,
    'qty', new.quantity, 'unit_price', new.unit_price + coalesce((new.customization->>'extras_per_item')::numeric, 0), 'summary', new.customization->>'summary',
    'design', new.customization, 'angle_path', new.reference_image_path, 'top_path', null);
  insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, 'system', 'design_card',
      'Your ' || case kind when 'cupcake' then 'cupcake' when 'donut' then 'donut' when 'cakepop' then 'cake pop' else 'bento' end || ' design for Order #' || o.order_number || ' is saved. This is what LexC''s will bake. Need a change? Reply here.',
      o.id, jsonb_build_array(entry))
    on conflict (order_id) where message_type = 'design_card'
    do update set attachments = public.chat_messages.attachments || excluded.attachments;
  return new;
end $$;
revoke all on function private.chat_design_card() from public;

create temp table moved_from(id uuid primary key) on commit drop;

-- 2. existing cards move to their order's chat (the chat is created when an older order has none)
do $$
declare r record; thread_id uuid;
begin
  for r in select m.id, m.order_id, m.conversation_id from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
           where m.message_type = 'design_card' and m.order_id is not null and c.order_id is distinct from m.order_id
  loop
    thread_id := private.order_thread((select o from public.orders o where o.id = r.order_id));
    update public.chat_messages set conversation_id = thread_id where id = r.id;
    insert into moved_from values (r.conversation_id) on conflict do nothing;
  end loop;
end $$;

-- 3. general chats that held nothing but those cards (now empty) are removed
delete from public.chat_conversations c
where c.id in (select id from moved_from) and c.order_id is null and not exists (select 1 from public.chat_messages m where m.conversation_id = c.id);

-- 4. order summaries show the order's current total (they were saved before the delivery-fee step was removed)
update public.chat_messages m set attachments = m.attachments || jsonb_build_object('total', o.total_amount, 'deposit_due', o.deposit_due,
    'delivery_fee', o.delivery_fee, 'delivery_fee_status', o.delivery_fee_status)
from public.orders o
where o.id = m.order_id and m.message_type = 'order_summary' and m.attachments->>'total' is null and o.total_amount is not null;
commit;
