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
--
-- What it does NOT do: allow cancelling once a receipt is under review, a downpayment is verified, or baking
-- started; change any money; touch inventory (stock is only taken at "Start making").
--
-- How to apply: rehearse first in a transaction you roll back, then run this whole file once in the Supabase SQL
-- editor. Safe to run twice. NOT applied yet (prepared 2026-11-02).

do $$
declare def text;
  a1 text := 'if result.status <> ''pending'' or result.payment_status not in (''unpaid'', ''rejected'') or result.amount_paid <> 0 then';
  b1 text := 'if result.status not in (''pending'', ''confirmed'') or result.payment_status not in (''unpaid'', ''rejected'') or result.amount_paid <> 0 then';
  a2 text := '  update public.orders set status = ''cancelled''
  where id = target_order returning * into result;';
  b2 text := '  update public.orders set status = ''cancelled''
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
