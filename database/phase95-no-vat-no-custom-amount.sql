-- Phase 95 · No VAT, and no "Pay a different amount".
--
-- Why: LexC's is not VAT-registered, so VAT must not be charged. And customers now pay either the downpayment or the
-- full amount (the "different amount" choice from phase 78 is removed).
--
-- What it does:
--   1. New orders get vat_rate 0, so no VAT is added (the VAT step from phase 77 stays and simply adds ₱0).
--   2. Orders not paid yet lose their VAT now: total, downpayment and the reservation record are recalculated. An
--      order counts as "not paid yet" when no money was received and no receipt is being checked. If the customer
--      already prepared a payment but sent nothing, that prepared amount is corrected too. PayMongo payments that were
--      already started are left alone; their orders keep their VAT, and the notice at the end lists them.
--   3. Orders where money was received, or a receipt is being checked, keep their amounts exactly as they were.
--   4. start_order_payment accepts only "downpayment" or "full" (the custom amount is refused).
--
-- What it does NOT do: change prices, the 60% downpayment rate, the rush fee, the delivery fee, payments already
-- made, or any paid order.
--
-- Apply AFTER phase 94. Rehearse with database/tests/phase95-rehearsal.sql (rolls itself back), then run this whole
-- file once in the Supabase SQL editor. Safe to re-run.
begin;

alter table public.orders alter column vat_rate set default 0;

-- 1. orders not paid yet: no VAT. The phase 77 VAT step recalculates the downpayment when the total changes.
with fixable as (
  select o.id from public.orders o
  where o.vat_amount > 0 and o.amount_paid = 0 and o.status not in ('cancelled', 'completed')
    and not exists (select 1 from public.order_payment_attempts a
                    where a.order_id = o.id and (a.status in ('verification_pending', 'paid')
                      or (a.status = 'awaiting_payment' and (a.provider_checkout_id is not null or a.provider_payment_id is not null))))
)
update public.orders o set vat_rate = 0, total_amount = o.total_amount - o.vat_amount
from fixable f where o.id = f.id;

-- a payment prepared for one of those orders (nothing sent yet) asks for the new amount
update public.order_payment_attempts a
set amount = case when a.payment_kind = 'full' or o.deposit_due >= o.total_amount then o.total_amount else o.deposit_due end
from public.orders o
where a.order_id = o.id and a.status = 'awaiting_payment' and o.vat_rate = 0 and o.amount_paid = 0
  and a.provider_checkout_id is null and a.provider_payment_id is null
  and a.amount <> case when a.payment_kind = 'full' or o.deposit_due >= o.total_amount then o.total_amount else o.deposit_due end;

-- 2. no more custom amounts
do $$
declare def text := pg_get_functiondef('private.start_order_payment(uuid,text,text,numeric)'::regprocedure);
  old_check text := 'if pay_option is not null and pay_option not in (''downpayment'',''full'',''custom'') then
    raise exception ''Choose downpayment, full payment, or your own amount.'' using errcode=''22023'';';
  new_check text := 'if pay_option is not null and pay_option not in (''downpayment'',''full'') then
    raise exception ''Choose the downpayment or the full payment.'' using errcode=''22023'';';
begin
  if position(new_check in def) > 0 then return; end if;            -- already applied
  if position(old_check in def) = 0 then
    raise exception 'private.start_order_payment is not the expected version; review before applying phase 95.';
  end if;
  execute replace(def, old_check, new_check);
end $$;

-- 3. what still carries VAT (paid or being paid) — for the owner's records
do $$
declare n int; list text;
begin
  select count(*), string_agg('#' || order_number, ', ' order by order_number) into n, list
  from public.orders where vat_amount > 0 and status not in ('cancelled');
  raise notice 'Orders that keep their VAT because money was received or is being checked: % %', n, coalesce(list, '');
end $$;

commit;
notify pgrst, 'reload schema';
