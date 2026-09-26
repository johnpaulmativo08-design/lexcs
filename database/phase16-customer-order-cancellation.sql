-- Customer cancellation keeps the order and payment audit trail intact.
-- Run once in the Supabase SQL editor for an existing project.
create or replace function private.cancel_my_order(target_order uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.orders;
begin
  if auth.uid() is null then
    raise exception 'Sign in to cancel an order.' using errcode = '42501';
  end if;
  if target_order is null then
    raise exception 'Order ID is required.';
  end if;

  -- Match the slot-first locking order used by checkout and Admin status changes.
  perform 1 from public.availability_slots
  where id = (select slot_id from public.orders where id = target_order and customer_id = auth.uid())
  for update;

  select * into result from public.orders
  where id = target_order and customer_id = auth.uid()
  for update;
  if not found then
    raise exception 'Order not found.' using errcode = '42501';
  end if;
  if result.status = 'cancelled' then
    return result;
  end if;
  if result.status <> 'pending' or result.payment_status not in ('unpaid', 'rejected') or result.amount_paid <> 0 then
    raise exception 'This order cannot be cancelled online. Please contact LexC for help with its status or payment.';
  end if;

  update public.orders set status = 'cancelled'
  where id = target_order returning * into result;
  return result;
end;
$$;

revoke all on function private.cancel_my_order(uuid) from public;
revoke all on function private.cancel_my_order(uuid) from anon;
grant execute on function private.cancel_my_order(uuid) to authenticated;

create or replace function public.cancel_my_order(order_id uuid)
returns public.orders
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_my_order(order_id);
$$;

revoke all on function public.cancel_my_order(uuid) from public;
revoke all on function public.cancel_my_order(uuid) from anon;
grant execute on function public.cancel_my_order(uuid) to authenticated;
