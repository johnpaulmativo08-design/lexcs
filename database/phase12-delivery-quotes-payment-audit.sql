-- A delivery order cannot accept payment until the Admin sets its actual delivery fee.
alter table public.order_payment_attempts
  add column if not exists verification_note text;

create function private.quote_order_delivery(target_order uuid, quoted_fee numeric)
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
  if o.amount_paid > 0 or exists (
    select 1 from public.order_payment_attempts p
    where p.order_id=o.id and p.status in ('verification_pending','paid')
  ) then
    raise exception 'This quote cannot change after payment submission. Resolve the payment first.';
  end if;
  update public.orders set delivery_fee=quoted_fee, delivery_fee_status='quoted',
    total_amount=items_subtotal+customization_total+quoted_fee,
    deposit_due=round((items_subtotal+customization_total+quoted_fee)*deposit_rate,2)
    where id=o.id returning * into o;
  return o;
end $$;
revoke all on function private.quote_order_delivery(uuid,numeric) from public;
grant execute on function private.quote_order_delivery(uuid,numeric) to authenticated;

create function public.quote_order_delivery(target_order uuid, quoted_fee numeric)
returns public.orders language sql security invoker set search_path='' as $$
  select private.quote_order_delivery(target_order,quoted_fee)
$$;
revoke all on function public.quote_order_delivery(uuid,numeric) from public;
grant execute on function public.quote_order_delivery(uuid,numeric) to authenticated;

create or replace function private.review_order_payment(target_payment uuid,decision text,review_reason text)
returns public.order_payment_attempts language plpgsql security definer set search_path='' as $$
declare p public.order_payment_attempts; o public.orders; verified_total numeric(12,2);
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Admin access required.' using errcode='42501'; end if;
  if decision not in ('paid','rejected') then raise exception 'Choose paid or rejected.'; end if;
  if nullif(btrim(coalesce(review_reason,'')),'') is null then raise exception 'Record the bank verification or rejection reason.'; end if;
  select * into p from public.order_payment_attempts where id=target_payment;
  if not found then raise exception 'Payment attempt not found.'; end if;
  select * into o from public.orders where id=p.order_id for update;
  select * into p from public.order_payment_attempts where id=target_payment for update;
  if p.status<>'verification_pending' then raise exception 'Payment has already been processed.'; end if;
  if decision='paid' then
    if o.status='cancelled' then raise exception 'Cancelled order requires separate resolution before payment approval.'; end if;
    if o.total_amount is null or o.amount_paid+p.amount>o.total_amount then raise exception 'Payment exceeds the order balance.'; end if;
    update public.order_payment_attempts set status='paid',verified_at=now(),verified_by=auth.uid(),
      verification_note=left(btrim(review_reason),1000)
      where id=p.id returning * into p;
    select coalesce(sum(amount),0) into verified_total from public.order_payment_attempts
      where order_id=o.id and status='paid';
    update public.orders set amount_paid=verified_total,
      payment_status=case when verified_total>=total_amount then 'paid' else 'partially_paid' end,
      paid_at=case when verified_total>=total_amount then now() else paid_at end where id=o.id;
  else
    update public.order_payment_attempts set status='rejected',rejected_at=now(),
      rejection_reason=left(btrim(review_reason),1000) where id=p.id returning * into p;
    update public.orders set payment_status='rejected' where id=o.id;
  end if;
  return p;
end $$;
