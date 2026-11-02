-- Phase 93 · Customers can cancel until baking starts, even after paying part or all; LexC's refunds by hand.
--
-- Why: the owner wants customers to be able to cancel a pending or confirmed order even when some money was already
-- received (example: order #114, ₱50 of the downpayment verified). The owner sends that money back herself.
--
-- What it does (in-place patch of private.cancel_my_order, on top of phase 92, with exact-match guards):
--   1. Allowed while the order is pending or confirmed, whatever was paid — but not while a receipt is waiting to be
--      checked (verification pending), and never once baking started (preparing / ready / completed).
--   2. When money had been received, a message in the order's chat says how much LexC's will refund, so the owner
--      sees it in Chats and the customer has it in writing.
--   Kept from phase 92: open payment requests close with the order; refused while an online QR could still be paid.
--
-- What it does NOT do: send money back, change amount_paid or payment status (the refund is the owner's own step),
-- or touch inventory (stock is only taken at "Start making").
--
-- How to apply: rehearse with database/tests/phase93-rehearsal.sql (rolls itself back), then run this whole file
-- once in the Supabase SQL editor. Safe to run twice.

do $$
declare def text;
  a1 text := 'if result.status not in (''pending'', ''confirmed'') or result.payment_status not in (''unpaid'', ''rejected'') or result.amount_paid <> 0 then';
  b1 text := 'if result.status not in (''pending'', ''confirmed'') or result.payment_status = ''verification_pending'' then   -- phase 93: until baking starts';
  a2 text := '   where order_id = target_order and status = ''awaiting_payment'';';
  b2 text := '   where order_id = target_order and status = ''awaiting_payment'';
  if result.amount_paid > 0 then                                                    -- phase 93: refund note in the order chat
    insert into public.chat_messages(conversation_id, sender_type, message_type, body)
    select c.id, ''system'', ''status_update'', ''Cancelled by the customer. LexC''''s will refund the ₱'' || to_char(result.amount_paid, ''FM999,999,990.00'') || '' already received.''
      from public.chat_conversations c where c.order_id = target_order;
  end if;';
begin
  def := pg_get_functiondef('private.cancel_my_order(uuid)'::regprocedure);
  if position('phase 93' in def) > 0 then raise notice 'cancel_my_order already allows cancelling until baking starts.'; return; end if;
  if (length(def) - length(replace(def, a1, ''))) / length(a1) <> 1 or (length(def) - length(replace(def, a2, ''))) / length(a2) <> 1 then
    raise exception 'private.cancel_my_order is not the phase 92 version; review before applying phase 93.'; end if;
  execute replace(replace(def, a1, b1), a2, b2);
end $$;

notify pgrst, 'reload schema';
