-- Phase 70 · Archive chats from the admin.
--
-- What it does: lets the owner archive a conversation she considers finished, so it leaves the "All" list in
-- Chat & Orders and waits under "Archived". No new table or column: an archived chat is the existing 'resolved'
-- state of public.chat_conversations. Unarchiving sets it back to 'active'.
--
-- What stays the same: every message is kept. Customers are not told. If the customer writes again (or the order's
-- status changes), the existing triggers set the chat to 'needs_admin', so an archived chat reopens by itself.
--
-- Who can use it: administrators only — checked inside the function. Customers still cannot change chat state.
--
-- How to apply: run this whole file once in the Supabase SQL editor. It only adds two functions; it changes no data.

create or replace function private.set_chat_archived(conversation_id uuid, archived boolean)
returns public.chat_conversations language plpgsql security definer set search_path='' as $$
declare c public.chat_conversations;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  update public.chat_conversations
     set state = case when archived then 'resolved' else 'active' end, updated_at = now()
   where id = conversation_id
  returning * into c;
  if not found then raise exception 'Conversation not found.'; end if;
  return c;
end $$;
revoke all on function private.set_chat_archived(uuid, boolean) from public;
grant execute on function private.set_chat_archived(uuid, boolean) to authenticated;

create or replace function public.set_chat_archived(conversation_id uuid, archived boolean)
returns public.chat_conversations language sql security invoker set search_path='' as $$
  select private.set_chat_archived(conversation_id, archived)
$$;
revoke all on function public.set_chat_archived(uuid, boolean) from public;
grant execute on function public.set_chat_archived(uuid, boolean) to authenticated;
