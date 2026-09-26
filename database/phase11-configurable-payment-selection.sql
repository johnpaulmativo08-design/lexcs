-- New orders store payment method codes; existing historical preference labels remain untouched.
alter table public.orders drop constraint if exists orders_requested_payment_method_check;
alter table public.orders add constraint orders_requested_payment_method_check
  check (requested_payment_method is null or length(requested_payment_method) between 2 and 60);

create or replace function private.prepare_manual_payment_order() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists (select 1 from public.payment_methods m
    where m.code=new.requested_payment_method and m.active) then
    raise exception 'Choose an available manual payment method.';
  end if;
  if new.total_amount is not null then new.deposit_due:=round(new.total_amount*new.deposit_rate,2); end if;
  return new;
end $$;
