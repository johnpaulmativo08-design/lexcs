-- Phase 63: "Start making". Materials are deducted from stock when Admin starts making the order (status Preparing),
-- not as soon as it is confirmed and paid. Start making is allowed only after the order is confirmed and its payment
-- (downpayment or full) is verified. Orders already deducted are unchanged. Safe to re-run.
begin;
create or replace function private.order_inventory_eligible(o public.orders) returns boolean language sql immutable set search_path='' as $$
  select o.status in ('preparing','ready','completed') and o.payment_status in ('partially_paid','paid')
$$;
revoke all on function private.order_inventory_eligible(public.orders) from public;

create or replace function private.require_payment_to_start() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'preparing' and old.status is distinct from 'preparing' and new.payment_status not in ('partially_paid','paid') then
    raise exception 'Verify the customer''s payment before you start making this order.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.require_payment_to_start() from public;
drop trigger if exists orders_require_payment_to_start on public.orders;
create trigger orders_require_payment_to_start before update of status on public.orders for each row execute function private.require_payment_to_start();
commit;
