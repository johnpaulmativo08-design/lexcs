-- Phase 46: customers pay only after LexC's confirms the order, then choose a downpayment or the full amount.
--  * start_order_payment refuses pending orders and takes the customer's choice (downpayment | full);
--    after a downpayment is verified the next payment is always the remaining balance.
--  * Each payment records what it is for (payment_kind), so Orders and Payments can show it.
--  * A Lalamove order needs its delivery fee before it can be confirmed (the customer pays right after).
--  * Confirming an order tells the customer in chat that payment is open.
-- Payments already started or submitted are left as they are. Safe to re-run.
begin;

alter table public.order_payment_attempts add column if not exists payment_kind text;
alter table public.order_payment_attempts drop constraint if exists order_payment_attempts_payment_kind_check;
alter table public.order_payment_attempts add constraint order_payment_attempts_payment_kind_check
  check (payment_kind is null or payment_kind in ('downpayment','full','balance'));

-- Confirming a delivery order requires its final price.
create or replace function private.require_quote_before_confirm() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status='pending' and new.status='confirmed' and new.total_amount is null then
    raise exception 'Set the Lalamove delivery fee before confirming. The customer pays right after you confirm.'
      using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.require_quote_before_confirm() from public;
drop trigger if exists orders_quote_before_confirm on public.orders;
create trigger orders_quote_before_confirm before update of status on public.orders
  for each row execute function private.require_quote_before_confirm();

-- Customer starts (or changes, before sending proof) the payment for a confirmed order.
drop function if exists public.start_order_payment(uuid,text);
drop function if exists private.start_order_payment(uuid,text);
create or replace function private.start_order_payment(target_order uuid, method_code text, pay_option text default null)
returns public.order_payment_attempts language plpgsql security definer set search_path='' as $$
declare o public.orders; m public.payment_methods; p public.order_payment_attempts; due numeric(12,2); kind text;
begin
  if auth.uid() is null then raise exception 'Sign in to pay for an order.' using errcode='42501'; end if;
  if pay_option is not null and pay_option not in ('downpayment','full') then
    raise exception 'Choose downpayment or full payment.' using errcode='22023';
  end if;
  select * into o from public.orders where id=target_order and customer_id=auth.uid() for update;
  if not found then raise exception 'Order not found.' using errcode='42501'; end if;
  if o.status='cancelled' then raise exception 'Cancelled orders cannot be paid.' using errcode='22023'; end if;
  if o.status='pending' then
    raise exception 'Please wait for LexC''s to confirm your order before paying.' using errcode='22023';
  end if;
  if o.total_amount is null or o.deposit_due is null then
    raise exception 'Waiting for the final delivery quote before payment.' using errcode='22023';
  end if;
  if o.amount_paid>=o.total_amount then raise exception 'This order is already fully paid.' using errcode='22023'; end if;
  select * into m from public.payment_methods where code=method_code and active;
  if not found then raise exception 'Payment method is unavailable.' using errcode='22023'; end if;
  if o.amount_paid>0 then
    if pay_option='full' or o.amount_paid>=o.deposit_due then kind:='balance'; due:=o.total_amount-o.amount_paid;
    else kind:='downpayment'; due:=o.deposit_due-o.amount_paid; end if;
  elsif pay_option='full' or o.deposit_due>=o.total_amount then kind:='full'; due:=o.total_amount;
  else kind:='downpayment'; due:=o.deposit_due; end if;
  if due<=0 then raise exception 'No payment is due.' using errcode='22023'; end if;
  select * into p from public.order_payment_attempts
    where order_id=o.id and status in ('awaiting_payment','verification_pending') for update;
  if found then
    if p.status='verification_pending' then return p; end if;
    -- no proof sent yet: the customer may switch account or amount
    update public.order_payment_attempts set payment_method_id=m.id,amount=due,payment_kind=kind
      where id=p.id returning * into p;
    return p;
  end if;
  insert into public.order_payment_attempts(order_id,customer_id,payment_method_id,amount,payment_kind)
    values(o.id,o.customer_id,m.id,due,kind) returning * into p;
  return p;
end $$;
revoke all on function private.start_order_payment(uuid,text,text) from public;
grant execute on function private.start_order_payment(uuid,text,text) to authenticated;
create or replace function public.start_order_payment(target_order uuid, method_code text, pay_option text default null)
returns public.order_payment_attempts language sql security invoker set search_path='' as $$
  select private.start_order_payment(target_order,method_code,pay_option)
$$;
revoke all on function public.start_order_payment(uuid,text,text) from public;
grant execute on function public.start_order_payment(uuid,text,text) to authenticated;

-- Status messages in the order's chat; confirming opens payment, so that one always reaches the customer.
create or replace function private.chat_order_event() returns trigger language plpgsql security definer set search_path='' as $$
declare thread_id uuid; opens_payment boolean:=old.status='pending' and new.status='confirmed';
begin
  if new.status is not distinct from old.status then return new; end if;
  select id into thread_id from public.chat_conversations where order_id=new.id;
  if thread_id is null and opens_payment then
    insert into public.chat_conversations(customer_id,order_id,state) values(new.customer_id,new.id,'active')
      on conflict (order_id) where order_id is not null do update set updated_at=now() returning id into thread_id;
  end if;
  if thread_id is not null then
    insert into public.chat_messages(conversation_id,sender_type,message_type,body)
      values(thread_id,'system','status_update',case when opens_payment
        then 'LexC''s confirmed your order. You can now pay the downpayment or the full amount: open My Orders → View order & payment.'
        else 'Order status changed to '||replace(new.status,'_',' ')||'. Check My Orders for the latest details.' end);
    update public.chat_conversations set updated_at=now() where id=thread_id;
  end if;
  return new;
end $$;
revoke all on function private.chat_order_event() from public;

do $$ begin
  if to_regprocedure('public.start_order_payment(uuid,text,text)') is null
    or to_regprocedure('public.start_order_payment(uuid,text)') is not null then
    raise exception 'Phase 46: start_order_payment was not replaced';
  end if;
end $$;
commit;
