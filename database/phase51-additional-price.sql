-- Phase 51: "Additional price" for custom work. Before confirming a pending order, LexC's can add a charge for the
-- extra effort and skill a custom design needs (amount + reason). The customer sees it in the order's chat and on the
-- payment page and either accepts or declines:
--   * accept  → the charge is added to the order (customization_total, so totals, downpayment, reports and the
--               delivery-fee quote all include it), and the order is confirmed so payment opens right away
--               (a Lalamove order still waits for its delivery fee);
--   * decline → nothing changes; the order stays pending and LexC's decides (new amount, confirm, or cancel).
-- While a price is waiting for the customer, the order cannot be confirmed at the old price. Safe to re-run.
begin;

alter table public.orders add column if not exists extra_charge numeric(12,2) not null default 0;
alter table public.orders drop constraint if exists orders_extra_charge_check;
alter table public.orders add constraint orders_extra_charge_check check (extra_charge >= 0);
alter table public.orders add column if not exists extra_charge_reason text;
-- the latest proposal: {status: awaiting|accepted|declined, amount, reason, old_total, new_total, proposed_at, responded_at}
alter table public.orders add column if not exists price_review jsonb;

-- allow the new chat card type (keep every type that exists today)
do $$
declare c record; kinds text[];
begin
  select array_agg(distinct k order by k) into kinds from (
    select unnest(array['text','system','payment_proof','payment_verified','payment_rejected','status_update','design_card','order_summary','price_review']) k
    union select distinct message_type from public.chat_messages) x;
  for c in select conname from pg_constraint
    where conrelid = 'public.chat_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%message_type%' and pg_get_constraintdef(oid) ilike '%payment_proof%'
  loop execute format('alter table public.chat_messages drop constraint %I', c.conname); end loop;
  execute format('alter table public.chat_messages add constraint chat_messages_message_type_check check (message_type = any (%L::text[]))', kinds);
end $$;

-- the order's own chat thread (created if missing)
create or replace function private.order_thread(o public.orders) returns uuid
language plpgsql security definer set search_path = '' as $$
declare thread_id uuid;
begin
  insert into public.chat_conversations(customer_id, order_id, state) values (o.customer_id, o.id, 'active')
    on conflict (order_id) where order_id is not null do update set updated_at = now()
    returning id into thread_id;
  return thread_id;
end $$;
revoke all on function private.order_thread(public.orders) from public;

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
  if char_length(why) < 3 or char_length(why) > 300 then raise exception 'Explain the additional price in a few words (up to 300 characters).' using errcode = '22023'; end if;
  review := jsonb_build_object('status', 'awaiting', 'amount', add, 'reason', why, 'old_total', o.total_amount,
    'new_total', case when o.total_amount is null then null else o.total_amount + add end, 'proposed_at', now());
  update public.orders set price_review = review where id = o.id;
  thread_id := private.order_thread(o);
  -- an earlier proposal that was still waiting is replaced by this one
  update public.chat_messages set attachments = attachments || '{"status":"replaced"}'::jsonb
    where order_id = o.id and message_type = 'price_review' and attachments->>'status' = 'awaiting';
  money := to_char(add, 'FM999,999,990.00');
  insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, 'system', 'price_review',
      'LexC''s reviewed your custom order and added ₱' || money || ' for: ' || why || '. Please accept the new price to continue, or decline.',
      o.id, review || jsonb_build_object('order_number', o.order_number));
  update public.chat_conversations set updated_at = now(), state = 'active' where id = thread_id;
  return review;
end $$;
revoke all on function private.propose_order_extra(uuid, numeric, text) from public;

create or replace function private.respond_order_extra(target_order uuid, accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; review jsonb; add numeric(12,2); thread_id uuid; total numeric(12,2);
begin
  if auth.uid() is null then raise exception 'Sign in to answer this price.' using errcode = '42501'; end if;
  select * into o from public.orders where id = target_order and customer_id = auth.uid() for update;
  if o.id is null then raise exception 'Order not found.' using errcode = '42501'; end if;
  review := o.price_review;
  if review->>'status' is distinct from 'awaiting' then raise exception 'There is no new price waiting for your answer.' using errcode = '22023'; end if;
  if o.status <> 'pending' then raise exception 'This order can no longer change price.' using errcode = '22023'; end if;
  add := (review->>'amount')::numeric;
  thread_id := private.order_thread(o);
  if accept then
    total := case when o.total_amount is null then null else o.items_subtotal + o.customization_total + add + coalesce(o.delivery_fee, 0) end;
    review := review || jsonb_build_object('status', 'accepted', 'responded_at', now(), 'new_total', total);
    update public.orders set customization_total = customization_total + add, extra_charge = extra_charge + add,
      extra_charge_reason = btrim(coalesce(extra_charge_reason || ' · ', '') || (review->>'reason')),
      total_amount = total, deposit_due = case when total is null then null else round(total * deposit_rate, 2) end,
      price_review = review
    where id = o.id returning * into o;
    insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id)
      values (thread_id, 'system', 'status_update', 'The customer accepted the new price' || coalesce(' — new total ₱' || to_char(total, 'FM999,999,990.00'), '') || '.', o.id);
    -- payment opens straight away when the price is final (a delivery order still waits for its Lalamove fee)
    if o.total_amount is not null then update public.orders set status = 'confirmed' where id = o.id returning * into o; end if;
  else
    review := review || jsonb_build_object('status', 'declined', 'responded_at', now());
    update public.orders set price_review = review where id = o.id returning * into o;
    insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id)
      values (thread_id, 'system', 'status_update', 'The customer declined the additional price. LexC''s will follow up here.', o.id);
  end if;
  update public.chat_messages set attachments = attachments || jsonb_build_object('status', review->>'status', 'responded_at', review->'responded_at')
    where order_id = o.id and message_type = 'price_review' and attachments->>'status' = 'awaiting';
  update public.chat_conversations set updated_at = now(), state = 'needs_admin' where id = thread_id;
  return jsonb_build_object('status', review->>'status', 'order_status', o.status, 'total_amount', o.total_amount, 'deposit_due', o.deposit_due);
end $$;
revoke all on function private.respond_order_extra(uuid, boolean) from public;

create or replace function public.propose_order_extra(target_order uuid, amount numeric, reason text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.propose_order_extra(target_order, amount, reason) $$;
revoke all on function public.propose_order_extra(uuid, numeric, text) from public, anon;
grant execute on function private.propose_order_extra(uuid, numeric, text) to authenticated;
grant execute on function public.propose_order_extra(uuid, numeric, text) to authenticated;

create or replace function public.respond_order_extra(target_order uuid, accept boolean) returns jsonb
language sql security invoker set search_path = '' as $$ select private.respond_order_extra(target_order, accept) $$;
revoke all on function public.respond_order_extra(uuid, boolean) from public, anon;
grant execute on function private.respond_order_extra(uuid, boolean) to authenticated;
grant execute on function public.respond_order_extra(uuid, boolean) to authenticated;

-- Confirming needs the final price: not while a new price waits for the customer, and not before the delivery fee.
create or replace function private.require_quote_before_confirm() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status='pending' and new.status='confirmed' and new.price_review->>'status' = 'awaiting' then
    raise exception 'Waiting for the customer to accept the additional price. Confirm after they answer, or add a different price.'
      using errcode='22023';
  end if;
  if old.status='pending' and new.status='confirmed' and new.total_amount is null then
    raise exception 'Set the Lalamove delivery fee before confirming. The customer pays right after you confirm.'
      using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function private.require_quote_before_confirm() from public;
commit;
