-- Phase 92 rehearsal · customers cancel confirmed, unpaid orders, WITHOUT saving anything.
-- Run the whole file in the Supabase SQL editor. It applies phase 92 twice, checks the new rules are in the function,
-- then ends with an error on purpose so nothing is saved.
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL lines.

do $$
declare def text;
  a1 text := 'if result.status <> ''pending'' or result.payment_status not in (''unpaid'', ''rejected'') or result.amount_paid <> 0 then';
  b1 text := 'if result.status not in (''pending'', ''confirmed'') or result.payment_status not in (''unpaid'', ''rejected'') or result.amount_paid <> 0 then';
  a2 text := '  update public.orders set status = ''cancelled''
  where id = target_order returning * into result;';
  b2 text := '  -- phase 92: not while an online (PayMongo) QR made in the last 35 minutes could still be paid; QR codes last 30
  if exists (select 1 from public.order_payment_attempts where order_id = target_order and status = ''awaiting_payment''
              and provider_checkout_id is not null and updated_at > now() - interval ''35 minutes'') then
    raise exception ''An online payment was started for this order. Wait 30 minutes for its QR code to expire, or message LexC''''s to cancel.'';
  end if;
  update public.orders set status = ''cancelled''
  where id = target_order returning * into result;
  update public.order_payment_attempts set status = ''cancelled''          -- phase 92: open requests close with the order
   where order_id = target_order and status = ''awaiting_payment'';';
begin
  def := pg_get_functiondef('private.cancel_my_order(uuid)'::regprocedure);
  if position('phase 92' in def) > 0 then raise notice 'cancel_my_order already allows confirmed orders.'; return; end if;
  if (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 or (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 then
    raise exception 'private.cancel_my_order is not the expected version; review before applying phase 92.'; end if;
  execute replace(replace(def, a1, b1), a2, b2);
end $$;


-- second run (must say it is already applied)
do $$
declare def text;
  a1 text := 'if result.status <> ''pending'' or result.payment_status not in (''unpaid'', ''rejected'') or result.amount_paid <> 0 then';
  b1 text := 'if result.status not in (''pending'', ''confirmed'') or result.payment_status not in (''unpaid'', ''rejected'') or result.amount_paid <> 0 then';
  a2 text := '  update public.orders set status = ''cancelled''
  where id = target_order returning * into result;';
  b2 text := '  -- phase 92: not while an online (PayMongo) QR made in the last 35 minutes could still be paid; QR codes last 30
  if exists (select 1 from public.order_payment_attempts where order_id = target_order and status = ''awaiting_payment''
              and provider_checkout_id is not null and updated_at > now() - interval ''35 minutes'') then
    raise exception ''An online payment was started for this order. Wait 30 minutes for its QR code to expire, or message LexC''''s to cancel.'';
  end if;
  update public.orders set status = ''cancelled''
  where id = target_order returning * into result;
  update public.order_payment_attempts set status = ''cancelled''          -- phase 92: open requests close with the order
   where order_id = target_order and status = ''awaiting_payment'';';
begin
  def := pg_get_functiondef('private.cancel_my_order(uuid)'::regprocedure);
  if position('phase 92' in def) > 0 then raise notice 'cancel_my_order already allows confirmed orders.'; return; end if;
  if (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 or (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 then
    raise exception 'private.cancel_my_order is not the expected version; review before applying phase 92.'; end if;
  execute replace(replace(def, a1, b1), a2, b2);
end $$;


do $rehearsal$
declare report text := ''; def text := pg_get_functiondef('private.cancel_my_order(uuid)'::regprocedure);
begin
  report := report || E'
' || case when position('not in (''pending'', ''confirmed'')' in def) > 0 then 'PASS' else 'FAIL' end || '  confirmed orders can be cancelled';
  report := report || E'
' || case when position('payment_status not in (''unpaid'', ''rejected'') or result.amount_paid <> 0' in def) > 0 then 'PASS' else 'FAIL' end || '  still only when nothing is paid or under review';
  report := report || E'
' || case when position('interval ''35 minutes''' in def) > 0 then 'PASS' else 'FAIL' end || '  refused while an online QR could still be paid';
  report := report || E'
' || case when position('status = ''cancelled''          -- phase 92' in def) > 0 then 'PASS' else 'FAIL' end || '  open payment requests close with the order';
  report := report || E'
' || case when (length(def) - length(replace(def, 'phase 92: not while', ''))) / length('phase 92: not while') = 1 then 'PASS' else 'FAIL' end || '  patched exactly once';
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
