-- A payment attempt captures a fixed amount. Never let a later quote silently change it.
create or replace function private.quote_order_delivery(target_order uuid, quoted_fee numeric)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Admin access required.' using errcode='42501';
  end if;
  if quoted_fee is null or quoted_fee < 0 or quoted_fee > 99999
    or quoted_fee <> round(quoted_fee, 2) then
    raise exception 'Enter a valid delivery fee in pesos and centavos.';
  end if;
  select * into o from public.orders where id=target_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if o.fulfillment_method <> 'lalamove' or o.status='cancelled' then
    raise exception 'Only an active delivery order can receive a quote.';
  end if;
  if exists (select 1 from public.order_payment_attempts p where p.order_id=o.id) then
    raise exception 'The delivery quote cannot change after payment has started. Resolve the payment first.';
  end if;
  update public.orders set delivery_fee=quoted_fee, delivery_fee_status='quoted',
    total_amount=items_subtotal+customization_total+quoted_fee,
    deposit_due=round((items_subtotal+customization_total+quoted_fee)*deposit_rate,2)
    where id=o.id returning * into o;
  return o;
end $$;
