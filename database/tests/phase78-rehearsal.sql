-- Phase 78 rehearsal · tests "pay a different amount" on the real database WITHOUT saving anything.
--
-- Run this whole file at once in the Supabase SQL editor. It applies phase 78, then as a pretend customer order:
-- pays ₱100 of the downpayment, has it verified by the admin, checks the order is still not "downpayment paid" and
-- that Start making is refused, then pays the rest of the downpayment and checks it now counts. It also checks the
-- limits (₱0, too many decimals, more than what is unpaid). It ends with an error on purpose: that cancels the whole
-- transaction, so nothing is saved.
--
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL for each check.

-- ===== phase 78 =====
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


do $rehearsal$
declare
  admin_id uuid; customer_id uuid; v public.product_variants; slot_id uuid; res jsonb; ord public.orders; pay public.order_payment_attempts;
  report text := ''; ok boolean; method text;
begin
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' limit 1;
  select u.id into customer_id from auth.users u join public.profiles p on p.id = u.id left join public.user_roles r on r.user_id = u.id
   where coalesce(r.role, 'customer') = 'customer' and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now())
   order by u.created_at limit 1;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id
   left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 1 and pr.status = 'active' and pr.kind = 'standard' and (pr.category_id is null or c.is_active)
   order by pv.price desc limit 1;
  select s.id into slot_id from public.availability_slots s
   where s.is_open and s.starts_at > now() + interval '2 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity
   order by s.starts_at limit 1;
  select pm.code into method from public.payment_methods pm where pm.active order by pm.code limit 1;
  if slot_id is null or v.id is null then raise exception 'REHEARSAL could not place a pretend order.'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  res := public.create_order(jsonb_build_object('request_id', gen_random_uuid(), 'name', 'Rehearsal', 'phone', '09171234567', 'fulfillment', 'pickup',
    'slot_id', slot_id, 'notes', 'phase 78 rehearsal', 'payment_method', method, 'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1))));
  perform set_config('role', 'postgres', true);
  update public.orders set status = 'confirmed' where id = (res->>'id')::uuid returning * into ord;
  report := report || E'\nINFO  pretend order: total ' || ord.total_amount || ', downpayment ' || ord.deposit_due;

  perform set_config('role', 'authenticated', true);
  -- limits
  begin perform public.start_order_payment(ord.id, method, 'custom', 0); report := report || E'\nFAIL  ₱0 was accepted';
  exception when others then report := report || E'\nPASS  ₱0 refused: ' || sqlerrm; end;
  begin perform public.start_order_payment(ord.id, method, 'custom', 10.005); report := report || E'\nFAIL  three decimals accepted';
  exception when others then report := report || E'\nPASS  three decimals refused'; end;
  begin perform public.start_order_payment(ord.id, method, 'custom', ord.total_amount + 1); report := report || E'\nFAIL  more than the total accepted';
  exception when others then report := report || E'\nPASS  more than unpaid refused: ' || sqlerrm; end;
  -- the existing three-argument call still works (the shop before this update)
  pay := public.start_order_payment(ord.id, method, 'full');
  ok := pay.amount = ord.total_amount and pay.payment_kind = 'full';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  full payment unchanged (' || pay.amount || ', ' || pay.payment_kind || ')';
  -- ₱100 now
  pay := public.start_order_payment(ord.id, method, 'custom', 100);
  ok := pay.amount = 100 and pay.payment_kind = 'downpayment';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  custom ₱100 prepared as ' || pay.payment_kind;
  perform set_config('role', 'postgres', true);

  -- the receipt (the Edge Function does this part) and the admin verifying it
  update public.order_payment_attempts set status = 'verification_pending', submitted_at = now(), transaction_reference = '1234567890', proof_storage_path = 'rehearsal/proof.jpg' where id = pay.id;
  update public.orders set payment_status = 'verification_pending' where id = ord.id;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  perform public.review_order_payment(pay.id, 'paid', 'phase 78 rehearsal');
  perform set_config('role', 'postgres', true);
  select * into ord from public.orders where id = ord.id;
  ok := ord.amount_paid = 100 and ord.payment_status = 'unpaid';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  after ₱100 verified: paid ' || ord.amount_paid || ', status ' || ord.payment_status || ' (not downpayment paid)';
  begin
    update public.orders set status = 'preparing' where id = ord.id;
    report := report || E'\nFAIL  Start making allowed with only part of the downpayment';
  exception when others then report := report || E'\nPASS  Start making refused: ' || sqlerrm; end;

  -- the default next payment is the rest of the downpayment
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  pay := public.start_order_payment(ord.id, method, 'downpayment');
  ok := pay.amount = ord.deposit_due - 100 and pay.payment_kind = 'downpayment';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  rest of the downpayment: ' || pay.amount;
  begin perform public.start_order_payment(ord.id, method, 'custom', ord.total_amount - 99.99); report := report || E'\nFAIL  more than unpaid accepted after ₱100';
  exception when others then report := report || E'\nPASS  limit follows what is still unpaid'; end;
  pay := public.start_order_payment(ord.id, method, 'downpayment');
  perform set_config('role', 'postgres', true);
  update public.order_payment_attempts set status = 'verification_pending', submitted_at = now(), transaction_reference = '1234567891', proof_storage_path = 'rehearsal/proof2.jpg' where id = pay.id;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  perform public.review_order_payment(pay.id, 'paid', 'phase 78 rehearsal');
  perform set_config('role', 'postgres', true);
  select * into ord from public.orders where id = ord.id;
  ok := ord.amount_paid = ord.deposit_due and ord.payment_status = 'partially_paid';
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  full downpayment in: paid ' || ord.amount_paid || ', status ' || ord.payment_status;

  -- the balance can be a custom amount too
  perform set_config('request.jwt.claims', json_build_object('sub', customer_id, 'role', 'authenticated')::text, true); perform set_config('role', 'authenticated', true);
  pay := public.start_order_payment(ord.id, method, 'custom', ord.total_amount - ord.amount_paid);
  perform set_config('role', 'postgres', true);
  ok := pay.payment_kind = 'balance' and pay.amount = ord.total_amount - ord.amount_paid;
  report := report || E'\n' || case when ok then 'PASS' else 'FAIL' end || '  custom amount for the whole balance: ' || pay.amount || ' (' || pay.payment_kind || ')';

  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
