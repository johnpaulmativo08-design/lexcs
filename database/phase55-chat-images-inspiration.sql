-- Phase 55: customers can share pictures.
--  * In chat: up to 4 photos per message (optional text), e.g. a design idea that is different from the presets.
--  * While designing: up to 3 "inspiration" photos per designed item; after checkout they are kept on the order line
--    and posted in that order's chat.
-- Photos live in the private customer-references bucket, in the customer's own folder (only they and Admin can open
-- them). Customers still cannot write chat attachments directly: these checked functions do it. Safe to re-run.
begin;

alter table public.order_items add column if not exists inspiration_paths text[] not null default '{}';

-- allow the new chat message type (keep every type that exists today)
do $$
declare c record; kinds text[];
begin
  select array_agg(distinct k order by k) into kinds from (
    select unnest(array['text','system','payment_proof','payment_verified','payment_rejected','status_update','design_card','order_summary','price_review','image']) k
    union select distinct message_type from public.chat_messages) x;
  for c in select conname from pg_constraint
    where conrelid = 'public.chat_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%message_type%' and pg_get_constraintdef(oid) ilike '%payment_proof%'
  loop execute format('alter table public.chat_messages drop constraint %I', c.conname); end loop;
  execute format('alter table public.chat_messages add constraint chat_messages_message_type_check check (message_type = any (%L::text[]))', kinds);
end $$;

-- every path must be one of the caller's own uploaded pictures
create or replace function private.own_pictures(paths text[], max_count integer) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); p text; clean text[] := '{}';
begin
  if u is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  if paths is null or cardinality(paths) = 0 then return clean; end if;
  if cardinality(paths) > max_count then raise exception 'You can add up to % pictures.', max_count using errcode = '22023'; end if;
  foreach p in array paths loop
    if p is null or split_part(p, '/', 1) <> u::text or p like '%..%'
       or not exists (select 1 from storage.objects where bucket_id = 'customer-references' and name = p) then
      raise exception 'A picture could not be found. Please add it again.' using errcode = '22023';
    end if;
    if not p = any(clean) then clean := clean || p; end if;
  end loop;
  return clean;
end $$;
revoke all on function private.own_pictures(text[], integer) from public;

-- 1. a customer sends pictures in one of their chats
create or replace function private.send_chat_images(p_conversation uuid, p_paths text[], p_caption text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); c public.chat_conversations; pics text[]; note text := left(btrim(coalesce(p_caption, '')), 1000); msg_id uuid;
begin
  if u is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or c.customer_id <> u then raise exception 'This conversation is not available to your account.' using errcode = '42501'; end if;
  pics := private.own_pictures(p_paths, 4);
  if cardinality(pics) = 0 then raise exception 'Choose at least one picture.' using errcode = '22023'; end if;
  insert into public.chat_messages(conversation_id, sender_id, sender_type, message_type, body, order_id, attachments)
    values (c.id, u, 'customer', 'image',
      coalesce(nullif(note, ''), case when cardinality(pics) = 1 then 'Sent a picture' else 'Sent ' || cardinality(pics) || ' pictures' end),
      c.order_id, jsonb_build_object('images', to_jsonb(pics), 'caption', nullif(note, '')))
    returning chat_messages.id into msg_id;
  update public.chat_conversations set state = 'needs_admin', updated_at = now() where id = c.id;
  return msg_id;
end $$;
revoke all on function private.send_chat_images(uuid, text[], text) from public;
grant execute on function private.send_chat_images(uuid, text[], text) to authenticated;
create or replace function public.send_chat_images(p_conversation uuid, p_paths text[], p_caption text default null) returns uuid
language sql security invoker set search_path = '' as $$ select private.send_chat_images(p_conversation, p_paths, p_caption) $$;
revoke all on function public.send_chat_images(uuid, text[], text) from public, anon;
grant execute on function public.send_chat_images(uuid, text[], text) to authenticated;

-- 2. after checkout: inspiration pictures for designed items, kept on the order line and posted in the order's chat
--    p_items = [{"line": 1, "paths": ["<uid>/inspiration/…jpg", …]}, …]
create or replace function private.attach_inspiration(p_order_id uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); o public.orders; v jsonb; it public.order_items; pics text[]; thread_id uuid; n integer := 0;
begin
  if u is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order_id and customer_id = u;
  if o.id is null then raise exception 'This order is not available to your account.' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 50 then raise exception 'Invalid pictures.' using errcode = '22023'; end if;
  for v in select value from jsonb_array_elements(p_items) loop
    select * into it from public.order_items where order_id = o.id and line_number = (v->>'line')::int for update;
    if it.id is null then raise exception 'Order line not found.' using errcode = '22023'; end if;
    if cardinality(it.inspiration_paths) > 0 then continue; end if;   -- already attached (retries are harmless)
    pics := private.own_pictures(array(select jsonb_array_elements_text(coalesce(v->'paths', '[]'::jsonb))), 3);
    if cardinality(pics) = 0 then continue; end if;
    update public.order_items set inspiration_paths = pics where id = it.id;
    thread_id := private.order_thread(o);
    insert into public.chat_messages(conversation_id, sender_id, sender_type, message_type, body, order_id, attachments)
      values (thread_id, u, 'customer', 'image', 'Inspiration for ' || it.name_snapshot, o.id,
        jsonb_build_object('images', to_jsonb(pics), 'caption', 'Inspiration for ' || it.name_snapshot, 'line', it.line_number));
    n := n + 1;
  end loop;
  if n > 0 then update public.chat_conversations set updated_at = now() where order_id = o.id; end if;
  return n;
end $$;
revoke all on function private.attach_inspiration(uuid, jsonb) from public;
grant execute on function private.attach_inspiration(uuid, jsonb) to authenticated;
create or replace function public.attach_inspiration(p_order_id uuid, p_items jsonb) returns integer
language sql security invoker set search_path = '' as $$ select private.attach_inspiration(p_order_id, p_items) $$;
revoke all on function public.attach_inspiration(uuid, jsonb) from public, anon;
grant execute on function public.attach_inspiration(uuid, jsonb) to authenticated;
commit;
