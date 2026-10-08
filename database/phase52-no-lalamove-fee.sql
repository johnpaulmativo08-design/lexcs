-- Phase 52: no Lalamove delivery-fee step for now. A delivery order is priced like a pickup order (items + design
-- options); the customer pays the Lalamove rider directly. So a delivery order has its total right away, LexC's can
-- confirm it without setting a fee, and the customer can pay as soon as it is confirmed. Safe to re-run.
-- Also: the Additional price no longer needs a reason (the note is optional for now).
-- To bring the fee step back later: drop trigger orders_no_delivery_fee (the quote RPC and its columns are unchanged).
begin;

create or replace function private.no_delivery_fee() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.delivery_fee_status = 'unquoted' then
    new.delivery_fee := 0;
    new.delivery_fee_status := 'not_applicable';
    new.total_amount := new.items_subtotal + new.customization_total;
    new.deposit_due := round(new.total_amount * new.deposit_rate, 2);
  end if;
  return new;
end $$;
revoke all on function private.no_delivery_fee() from public;
drop trigger if exists orders_no_delivery_fee on public.orders;
create trigger orders_no_delivery_fee before insert on public.orders
  for each row execute function private.no_delivery_fee();

-- delivery orders still waiting for a fee get their total now (none of them could be paid yet)
update public.orders set delivery_fee = 0, delivery_fee_status = 'not_applicable',
  total_amount = items_subtotal + customization_total, deposit_due = round((items_subtotal + customization_total) * deposit_rate, 2)
where delivery_fee_status = 'unquoted' and status <> 'cancelled';

-- an additional price accepted while the fee was pending confirms the order now that its total is known
update public.orders set status = 'confirmed'
where status = 'pending' and price_review->>'status' = 'accepted' and total_amount is not null;

-- Additional price: amount only for now; a note is optional
create or replace function private.propose_order_extra(target_order uuid, amount numeric, reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; why text := btrim(regexp_replace(coalesce(reason, ''), '\s+', ' ', 'g')); add numeric(12,2) := round(coalesce(amount, 0), 2);
  review jsonb; thread_id uuid; money text;
begin
  perform private.require_admin();
  select * into o from public.orders where id = target_order for update;
  if o.id is null then raise exception 'Order not found.' using errcode = '22023'; end if;
  if o.status <> 'pending' then raise exception 'An additional price can only be added before the order is confirmed.' using errcode = '22023'; end if;
  if o.amount_paid > 0 or exists (select 1 from public.order_payment_attempts where order_id = o.id and status in ('awaiting_payment','verification_pending')) then
    raise exception 'The customer has already started paying for this order.' using errcode = '22023'; end if;
  if add <= 0 or add > 100000 then raise exception 'Enter an additional price between ₱1 and ₱100,000.' using errcode = '22023'; end if;
  if char_length(why) > 300 then raise exception 'Keep the note under 300 characters.' using errcode = '22023'; end if;
  review := jsonb_build_object('status', 'awaiting', 'amount', add, 'reason', nullif(why, ''), 'old_total', o.total_amount,
    'new_total', case when o.total_amount is null then null else o.total_amount + add end, 'proposed_at', now());
  update public.orders set price_review = review where id = o.id;
  thread_id := private.order_thread(o);
  -- an earlier proposal that was still waiting is replaced by this one
  update public.chat_messages set attachments = attachments || '{"status":"replaced"}'::jsonb
    where order_id = o.id and message_type = 'price_review' and attachments->>'status' = 'awaiting';
  money := to_char(add, 'FM999,999,990.00');
  insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, 'system', 'price_review',
      'LexC''s reviewed your custom order and added ₱' || money || coalesce(' for: ' || nullif(why, ''), ' for the extra work your design needs') || '. Please accept the new price to continue, or decline.',
      o.id, review || jsonb_build_object('order_number', o.order_number));
  update public.chat_conversations set updated_at = now(), state = 'active' where id = thread_id;
  return review;
end $$;
revoke all on function private.propose_order_extra(uuid, numeric, text) from public;
commit;
