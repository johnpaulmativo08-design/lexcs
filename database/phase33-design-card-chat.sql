-- Phase 33: bento "design card" in the customer's chat after a successful order.
-- Requires phase 18 (chat) and phase 32 (bento designer). Safe to run more than once.
--
-- When an order line with a bento design is saved, the database posts ONE system message per order
-- into the customer's general chat with LexC's. It lists every bento line: summary, price, the angled
-- design picture (order_items.reference_image_path) and the exact design choices (so the page can
-- rebuild the cake in 3D). The storefront then adds the top-view picture with attach_design_views().
-- Customers cannot write or edit these messages; only this trigger and that checked function can.

alter table public.chat_messages add column if not exists order_id uuid references public.orders(id) on delete cascade;
alter table public.chat_messages add column if not exists attachments jsonb;

-- Allow the new message type (the phase 18 check constraint has a generated name, so find it).
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.chat_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%message_type%payment_proof%'
  loop execute format('alter table public.chat_messages drop constraint %I', c.conname); end loop;
end $$;
alter table public.chat_messages add constraint chat_messages_message_type_check check (message_type in
  ('text','system','payment_proof','payment_verified','payment_rejected','status_update','design_card'));

create unique index if not exists chat_one_design_card_per_order on public.chat_messages(order_id) where message_type = 'design_card';

create or replace function private.chat_design_card() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders; thread_id uuid; entry jsonb;
begin
  if new.customization is null or new.customization->>'designer' is distinct from 'bento' then return new; end if;
  select * into o from public.orders where id = new.order_id;
  if not found then return new; end if;
  insert into public.chat_conversations(customer_id, order_id, state) values (o.customer_id, null, 'active')
    on conflict (customer_id) where order_id is null do update set updated_at = now()
    returning id into thread_id;
  entry := jsonb_build_object('line', new.line_number, 'name', new.name_snapshot, 'variant_id', new.variant_id,
    'qty', new.quantity, 'unit_price', new.unit_price + coalesce((new.customization->>'extras_per_item')::numeric, 0), 'summary', new.customization->>'summary',
    'design', new.customization, 'angle_path', new.reference_image_path, 'top_path', null);
  insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, 'system', 'design_card',
      'Your bento design for Order #' || o.order_number || ' is saved. This is what LexC''s will bake. Need a change? Reply here.',
      o.id, jsonb_build_array(entry))
    on conflict (order_id) where message_type = 'design_card'
    do update set attachments = public.chat_messages.attachments || excluded.attachments;
  return new;
end $$;
revoke all on function private.chat_design_card() from public;
drop trigger if exists chat_design_card on public.order_items;
create trigger chat_design_card after insert on public.order_items
  for each row execute function private.chat_design_card();

-- The customer's browser uploads the top-view picture, then attaches it to its own order's card.
-- p_views: [{"line": 1, "top_path": "<user id>/designs/<file>.jpg"}, ...]
create or replace function private.attach_design_views(p_order_id uuid, p_views jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); card public.chat_messages; v jsonb; path text; changed integer := 0; items jsonb;
begin
  if u is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.orders where id = p_order_id and customer_id = u) then
    raise exception 'This order is not available to your account.' using errcode = '42501'; end if;
  if jsonb_typeof(p_views) is distinct from 'array' or jsonb_array_length(p_views) > 100 then
    raise exception 'Invalid design pictures.' using errcode = '22023'; end if;
  select * into card from public.chat_messages where order_id = p_order_id and message_type = 'design_card' for update;
  if not found then return 0; end if;
  items := card.attachments;
  for v in select value from jsonb_array_elements(p_views) loop
    path := v->>'top_path';
    if path is null or split_part(path, '/', 1) <> u::text
      or not exists (select 1 from storage.objects where bucket_id = 'customer-references' and name = path) then
      raise exception 'Invalid design picture.' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(case when (e->>'line')::int = (v->>'line')::int and e->>'top_path' is null
        then e || jsonb_build_object('top_path', path) else e end order by ord), '[]'::jsonb)
      into items from jsonb_array_elements(items) with ordinality as t(e, ord);
    changed := changed + 1;
  end loop;
  update public.chat_messages set attachments = items where id = card.id;
  return changed;
end $$;
revoke all on function private.attach_design_views(uuid, jsonb) from public;
grant execute on function private.attach_design_views(uuid, jsonb) to authenticated;

create or replace function public.attach_design_views(p_order_id uuid, p_views jsonb) returns integer
language sql security invoker set search_path = '' as $$ select private.attach_design_views(p_order_id, p_views) $$;
revoke all on function public.attach_design_views(uuid, jsonb) from public, anon;
grant execute on function public.attach_design_views(uuid, jsonb) to authenticated;
