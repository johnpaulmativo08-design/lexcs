-- Phase 78 · "Pay a different amount": the customer may type how much to pay now (for when they can't send the whole
-- downpayment today).
--
-- Why: a customer may not have the full downpayment on hand. They can now send a smaller part now and the rest later,
-- or any amount up to the whole remaining total.
--
-- What it does:
--   1. start_order_payment takes a new choice, 'custom', with the amount the customer typed (custom_amount). Any amount
--      above ₱0 up to what is still unpaid on the order is accepted (two decimals at most). The payment is recorded as:
--        - 'full' / 'balance' when it pays off the whole order,
--        - 'downpayment' while the downpayment (60% + all VAT) is not yet complete,
--        - 'balance' once the downpayment is already complete.
--      The existing choices (downpayment, full, and the remaining balance afterwards) work exactly as before; after a
--      partial downpayment, the default next payment is the rest of the downpayment.
--   2. review_order_payment (when LexC's marks money received): the order only counts as "downpayment paid"
--      (payment_status 'partially_paid') once the money received reaches the full downpayment. Below that it stays
--      'unpaid', with the money received so far kept in amount_paid. So Start making — and the inventory deduction
--      that comes with it — stays locked until the whole downpayment is in, just like today.
--
-- What it does NOT do: change prices, VAT, the 60% rate, how receipts are uploaded, who can verify payments, the
-- inventory rules, or any existing order or payment.
--
-- How to apply: rehearse with database/tests/phase78-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor.

do $$
begin
  if position('else kind:=''downpayment''; due:=o.deposit_due; end if;' in pg_get_functiondef('private.start_order_payment(uuid,text,text)'::regprocedure)) = 0 then
    raise exception 'private.start_order_payment is not the expected version; review before applying phase 78.';
  end if;
end $$;

drop function if exists public.start_order_payment(uuid,text,text);
drop function if exists private.start_order_payment(uuid,text,text);
create or replace function private.start_order_payment(target_order uuid, method_code text, pay_option text default null, custom_amount numeric default null)
returns public.order_payment_attempts language plpgsql security definer set search_path='' as $$
declare o public.orders; m public.payment_methods; p public.order_payment_attempts; due numeric(12,2); kind text;
begin
  if auth.uid() is null then raise exception 'Sign in to pay for an order.' using errcode='42501'; end if;
  if pay_option is not null and pay_option not in ('downpayment','full','custom') then
    raise exception 'Choose downpayment, full payment, or your own amount.' using errcode='22023';
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
  if pay_option='custom' then
    -- the customer's own amount: above ₱0, centavos at most, never more than what is still unpaid
    if custom_amount is null or custom_amount<=0 or custom_amount<>round(custom_amount,2) then
      raise exception 'Enter an amount above ₱0 (up to two decimals).' using errcode='22023';
    end if;
    if custom_amount>o.total_amount-o.amount_paid then
      raise exception 'That is more than the ₱% still unpaid on this order.', to_char(o.total_amount-o.amount_paid,'FM999,999,990.00') using errcode='22023';
    end if;
    due:=custom_amount;
    kind:=case when o.amount_paid+due>=o.total_amount then case when o.amount_paid=0 then 'full' else 'balance' end
               when o.amount_paid<o.deposit_due then 'downpayment' else 'balance' end;
  elsif o.amount_paid>0 then
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
revoke all on function private.start_order_payment(uuid,text,text,numeric) from public;
grant execute on function private.start_order_payment(uuid,text,text,numeric) to authenticated;
create or replace function public.start_order_payment(target_order uuid, method_code text, pay_option text default null, custom_amount numeric default null)
returns public.order_payment_attempts language sql security invoker set search_path='' as $$
  select private.start_order_payment(target_order,method_code,pay_option,custom_amount)
$$;
revoke all on function public.start_order_payment(uuid,text,text,numeric) from public;
grant execute on function public.start_order_payment(uuid,text,text,numeric) to authenticated;

-- "Downpayment paid" only once the whole downpayment is in; less than that stays unpaid (money so far in amount_paid)
do $$
declare def text; a text := 'payment_status=case when verified_total>=total_amount then ''paid'' else ''partially_paid'' end';
begin
  def := pg_get_functiondef('private.review_order_payment(uuid,text,text)'::regprocedure);
  if position('verified_total>=deposit_due' in def) > 0 then return; end if;
  if (length(def) - length(replace(def, a, ''))) / length(a) <> 1 then
    raise exception 'private.review_order_payment is not the expected version; review before applying phase 78.';
  end if;
  execute replace(def, a, 'payment_status=case when verified_total>=total_amount then ''paid'' when verified_total>=deposit_due then ''partially_paid'' else ''unpaid'' end');
end $$;

notify pgrst, 'reload schema';
