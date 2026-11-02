-- Phase 93 rehearsal · cancel until baking starts with a refund note, WITHOUT saving anything.
-- Run the whole file in the Supabase SQL editor. It applies phase 93 twice, checks the function, then ends with an
-- error on purpose so nothing is saved.
-- Expected last line: ERROR: REHEARSAL REPORT (nothing was saved) … followed by PASS/FAIL lines.

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


-- second run (must say it is already applied)
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


do $rehearsal$
declare report text := ''; def text := pg_get_functiondef('private.cancel_my_order(uuid)'::regprocedure);
begin
  report := report || E'
' || case when position('payment_status = ''verification_pending'' then   -- phase 93' in def) > 0 then 'PASS' else 'FAIL' end || '  pending or confirmed, any payment, but not while a receipt is checked';
  report := report || E'
' || case when position('amount_paid <> 0' in def) = 0 then 'PASS' else 'FAIL' end || '  no longer requires nothing paid';
  report := report || E'
' || case when position('already received' in def) > 0 then 'PASS' else 'FAIL' end || '  refund note in the order chat';
  report := report || E'
' || case when position('interval ''35 minutes''' in def) > 0 then 'PASS' else 'FAIL' end || '  still refused while an online QR could be paid (phase 92)';
  report := report || E'
' || case when (length(def) - length(replace(def, 'phase 93: refund note', ''))) / length('phase 93: refund note') = 1 then 'PASS' else 'FAIL' end || '  patched exactly once';
  raise exception 'REHEARSAL REPORT (nothing was saved — this error undoes everything):%', report;
end $rehearsal$;
