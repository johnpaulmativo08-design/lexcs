-- Phase 92 · Customers can cancel a confirmed order that is not paid yet.
--
-- Why: today a customer can cancel only while the order is still "pending". After the owner confirms it, the
-- customer had to message LexC's even when nothing was paid.
--
-- What it does:
--   1. private.cancel_my_order also accepts status 'confirmed' (still: payment unpaid or rejected, nothing verified
--      paid). In-place patch with an exact-match guard.
--   2. When an order is cancelled this way, its open payment requests ("awaiting payment") are marked cancelled,
--      like phase 71 did for older cancelled orders, so nothing keeps showing as waiting.
--   3. Refuses while an online PayMongo QR made in the last 35 minutes could still be paid (QR codes last 30), so
--      money never lands on a cancelled order.
--
-- What it does NOT do: allow cancelling once a receipt is under review, a downpayment is verified, or baking
-- started; change any money; touch inventory (stock is only taken at "Start making").
--
-- How to apply: rehearse with database/tests/phase92-rehearsal.sql (rolls itself back), then run this whole file once in the Supabase SQL
-- editor. Safe to run twice.

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

notify pgrst, 'reload schema';
