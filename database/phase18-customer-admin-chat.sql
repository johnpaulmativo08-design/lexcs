-- Customer/admin conversations; payment and order records remain the source of truth.
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  state text not null default 'active' check (state in ('active','needs_admin','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chat_one_general_per_customer on public.chat_conversations(customer_id) where order_id is null;
create unique index if not exists chat_one_per_order on public.chat_conversations(order_id) where order_id is not null;
create index if not exists chat_conversations_customer_recent on public.chat_conversations(customer_id,updated_at desc);
drop trigger if exists chat_conversation_touch on public.chat_conversations;
create trigger chat_conversation_touch before update on public.chat_conversations
  for each row execute function private.touch_updated_at();

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id),
  sender_type text not null check (sender_type in ('customer','admin','system')),
  message_type text not null default 'text' check (message_type in ('text','system','payment_proof','payment_verified','payment_rejected','status_update')),
  body text not null default '' check (length(body)<=3000),
  payment_id uuid references public.order_payment_attempts(id),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((sender_type='system' and sender_id is null) or (sender_type<>'system' and sender_id is not null)),
  check (message_type='text' or sender_type='system')
);
create index if not exists chat_messages_thread_recent on public.chat_messages(conversation_id,created_at,id);
create unique index if not exists chat_one_payment_event on public.chat_messages(payment_id,message_type) where payment_id is not null;

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_conversations, public.chat_messages from anon, authenticated;
grant select on public.chat_conversations to authenticated;
grant insert(customer_id,order_id) on public.chat_conversations to authenticated;
grant update(read_at) on public.chat_messages to authenticated;
grant select on public.chat_messages to authenticated;
grant insert(conversation_id,sender_id,sender_type,message_type,body) on public.chat_messages to authenticated;

drop policy if exists chat_conversations_read on public.chat_conversations;
drop policy if exists chat_conversations_customer_create on public.chat_conversations;
drop policy if exists chat_messages_read on public.chat_messages;
drop policy if exists chat_messages_send on public.chat_messages;
drop policy if exists chat_messages_mark_read on public.chat_messages;
create policy chat_conversations_read on public.chat_conversations for select to authenticated
  using (customer_id=(select auth.uid()) or (select private.is_admin()));
create policy chat_conversations_customer_create on public.chat_conversations for insert to authenticated
  with check (customer_id=(select auth.uid()) and state='active' and
    (order_id is null or exists(select 1 from public.orders o where o.id=order_id and o.customer_id=(select auth.uid()))));
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (exists(select 1 from public.chat_conversations c where c.id=conversation_id and
    (c.customer_id=(select auth.uid()) or (select private.is_admin()))));
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id=(select auth.uid()) and message_type='text' and payment_id is null
    and ((sender_type='customer' and exists(select 1 from public.chat_conversations c
      where c.id=conversation_id and c.customer_id=(select auth.uid())))
      or (sender_type='admin' and (select private.is_admin()))));
create policy chat_messages_mark_read on public.chat_messages for update to authenticated
  using (sender_type<>case when (select private.is_admin()) then 'admin' else 'customer' end
    and exists(select 1 from public.chat_conversations c where c.id=conversation_id and
      (c.customer_id=(select auth.uid()) or (select private.is_admin()))))
  with check (sender_type<>case when (select private.is_admin()) then 'admin' else 'customer' end
    and exists(select 1 from public.chat_conversations c where c.id=conversation_id and
      (c.customer_id=(select auth.uid()) or (select private.is_admin()))));

create or replace function private.chat_payment_event() returns trigger language plpgsql security definer set search_path='' as $$
declare thread_id uuid; kind text; message_body text;
begin
  if new.status=old.status or new.status not in ('verification_pending','paid','rejected') then return new; end if;
  insert into public.chat_conversations(customer_id,order_id,state)
    values(new.customer_id,new.order_id,case when new.status='verification_pending' then 'needs_admin' else 'active' end)
    on conflict (order_id) where order_id is not null do update
      set updated_at=now(),state=excluded.state returning id into thread_id;
  kind:=case new.status when 'verification_pending' then 'payment_proof'
    when 'paid' then 'payment_verified' else 'payment_rejected' end;
  message_body:=case new.status
    when 'verification_pending' then 'Payment proof received. Admin will verify the actual bank credit. Please do not transfer again while this is pending.'
    when 'paid' then 'Payment verified by LexC. Your order payment details have been updated.'
    else 'A new payment proof was requested. Check the payment page for the reason and upload a corrected receipt.' end;
  insert into public.chat_messages(conversation_id,sender_type,message_type,body,payment_id)
    values(thread_id,'system',kind,message_body,new.id)
    on conflict (payment_id,message_type) where payment_id is not null do nothing;
  return new;
end $$;
revoke all on function private.chat_payment_event() from public;
drop trigger if exists chat_payment_state on public.order_payment_attempts;
create trigger chat_payment_state after update of status on public.order_payment_attempts
  for each row execute function private.chat_payment_event();

create or replace function private.chat_customer_reply() returns trigger language plpgsql security definer set search_path='' as $$
declare reply text;
begin
  if new.sender_type='admin' and new.message_type='text' then
    update public.chat_conversations set state='active',updated_at=now() where id=new.conversation_id;
    return new;
  end if;
  if new.sender_type<>'customer' or new.message_type<>'text' then return new; end if;
  if new.body ~* '(hour|open|close|location|address)' then
    reply:='Thanks for asking! For current hours and pickup details, please check the Contact and About sections. A LexC team member can confirm any special arrangement here.';
  elsif new.body ~* '(payment|proof|receipt|gcash|maya|maribank)' then
    reply:='For a saved order, open its payment page to see the exact amount and QR. Upload your bank receipt there; an Admin verifies the actual transfer. A team member will follow up if you need help.';
  elsif new.body ~* '(order|booking|pickup|delivery|status)' then
    reply:='Your saved order and booking status are available in My Orders. If you need a change, a LexC team member will review your message here.';
  else
    reply:='Thanks for your message! A LexC team member will reply in this conversation.';
  end if;
  update public.chat_conversations set state='needs_admin',updated_at=now() where id=new.conversation_id;
  insert into public.chat_messages(conversation_id,sender_type,message_type,body)
    values(new.conversation_id,'system','system',reply);
  return new;
end $$;
revoke all on function private.chat_customer_reply() from public;
drop trigger if exists chat_customer_auto_reply on public.chat_messages;
create trigger chat_customer_auto_reply after insert on public.chat_messages
  for each row execute function private.chat_customer_reply();

create or replace function private.chat_order_event() returns trigger language plpgsql security definer set search_path='' as $$
declare thread_id uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  select id into thread_id from public.chat_conversations where order_id=new.id;
  if thread_id is not null then
    insert into public.chat_messages(conversation_id,sender_type,message_type,body)
      values(thread_id,'system','status_update','Order status changed to '||replace(new.status,'_',' ')||'. Check My Orders for the latest details.');
    update public.chat_conversations set updated_at=now() where id=thread_id;
  end if;
  return new;
end $$;
revoke all on function private.chat_order_event() from public;
drop trigger if exists chat_order_state on public.orders;
create trigger chat_order_state after update of status on public.orders
  for each row execute function private.chat_order_event();
