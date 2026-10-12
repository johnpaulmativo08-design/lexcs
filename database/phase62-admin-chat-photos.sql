-- Phase 62: LexC's (Admin) can send photos in a customer's chat, like customers can (phase 55).
-- Admin photos are stored in that customer's private folder (customer-references/<customer>/chat/…), so only that
-- customer and Admin can open them. Up to 4 photos per message, with an optional note. Safe to re-run.
begin;

-- Admin may upload into a customer's folder (customers still only into their own)
drop policy if exists admin_reference_upload on storage.objects;
create policy admin_reference_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-references' and (select private.is_admin()));

-- people may post text; customers and Admin may post picture messages (only through send_chat_images)
alter table public.chat_messages drop constraint if exists chat_messages_check1;
alter table public.chat_messages add constraint chat_messages_check1
  check (message_type = 'text' or sender_type = 'system' or (message_type = 'image' and sender_type in ('customer', 'admin')));

create or replace function private.send_chat_images(p_conversation uuid, p_paths text[], p_caption text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); c public.chat_conversations; pics text[] := '{}'; p text; admin boolean := private.is_admin();
  note text := left(btrim(coalesce(p_caption, '')), 1000); msg_id uuid;
begin
  if u is null then raise exception 'Please sign in first.' using errcode = '42501'; end if;
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or (c.customer_id <> u and not admin) then raise exception 'This conversation is not available to your account.' using errcode = '42501'; end if;
  if admin and c.customer_id <> u then
    -- Admin's photos live in this customer's folder
    if p_paths is null or cardinality(p_paths) = 0 then raise exception 'Choose at least one picture.' using errcode = '22023'; end if;
    if cardinality(p_paths) > 4 then raise exception 'You can add up to 4 pictures.' using errcode = '22023'; end if;
    foreach p in array p_paths loop
      if p is null or split_part(p, '/', 1) <> c.customer_id::text or p like '%..%'
         or not exists (select 1 from storage.objects where bucket_id = 'customer-references' and name = p) then
        raise exception 'A picture could not be found. Please add it again.' using errcode = '22023';
      end if;
      if not p = any(pics) then pics := pics || p; end if;
    end loop;
  else
    pics := private.own_pictures(p_paths, 4);
  end if;
  if cardinality(pics) = 0 then raise exception 'Choose at least one picture.' using errcode = '22023'; end if;
  insert into public.chat_messages(conversation_id, sender_id, sender_type, message_type, body, order_id, attachments)
    values (c.id, u, case when admin and c.customer_id <> u then 'admin' else 'customer' end, 'image',
      coalesce(nullif(note, ''), case when cardinality(pics) = 1 then 'Sent a picture' else 'Sent ' || cardinality(pics) || ' pictures' end),
      c.order_id, jsonb_build_object('images', to_jsonb(pics), 'caption', nullif(note, '')))
    returning chat_messages.id into msg_id;
  update public.chat_conversations set state = case when admin and c.customer_id <> u then 'active' else 'needs_admin' end, updated_at = now() where id = c.id;
  return msg_id;
end $$;
revoke all on function private.send_chat_images(uuid, text[], text) from public;
grant execute on function private.send_chat_images(uuid, text[], text) to authenticated;
commit;
