-- Phase 59: receiving times and the rush fee.
--  * Open 9 AM–5 PM: one-hour receiving times (9, 10, 11, 12, 1, 2, 3, 4 PM). The old all-day windows are
--    removed (any that an order already uses are kept). The daily limit (6 bookings) still applies.
--  * Rush fee ₱200: an order for the day after it is placed (e.g. ordered Oct 19 for Oct 20) pays ₱200 more.
--    It is added to the order total and the downpayment and shown on the order. Safe to re-run.
begin;

-- 1. hourly receiving times through 2027
-- future all-day windows that no order uses are replaced (receiving times cannot overlap)
delete from public.availability_slots s
where s.starts_at > now() and s.ends_at - s.starts_at > interval '1 hour'
  and not exists (select 1 from public.orders o where o.slot_id = s.id);
insert into public.availability_slots(starts_at, ends_at, capacity, is_open)
select (d.day + make_time(h, 0, 0)) at time zone 'Asia/Manila', (d.day + make_time(h + 1, 0, 0)) at time zone 'Asia/Manila', 6, true
from generate_series((now() at time zone 'Asia/Manila')::date + 1, date '2027-12-31', interval '1 day') as g(ts)
cross join lateral (select g.ts::date as day) d
cross join generate_series(9, 16) as h
where not exists (select 1 from public.availability_slots s
  where s.starts_at < (d.day + make_time(h + 1, 0, 0)) at time zone 'Asia/Manila' and s.ends_at > (d.day + make_time(h, 0, 0)) at time zone 'Asia/Manila');

-- 2. rush fee on next-day orders
alter table public.orders add column if not exists rush_fee numeric(12,2) not null default 0;
alter table public.orders drop constraint if exists orders_rush_fee_check;
alter table public.orders add constraint orders_rush_fee_check check (rush_fee >= 0);
alter table public.orders drop constraint if exists orders_amounts_match;
alter table public.orders add constraint orders_amounts_match
  check ((delivery_fee_status='unquoted' and delivery_fee is null and total_amount is null and deposit_due is null)
    or (delivery_fee_status<>'unquoted' and delivery_fee is not null
      and total_amount=items_subtotal+customization_total+delivery_fee+rush_fee
      and deposit_due=round(total_amount*deposit_rate,2)));

create or replace function private.order_rush_fee() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.receiving_start is not null
     and (new.receiving_start at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date + 1 then
    new.rush_fee := 200;
    if new.total_amount is not null then
      new.total_amount := new.total_amount + 200;
      new.deposit_due := round(new.total_amount * new.deposit_rate, 2);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.order_rush_fee() from public;
drop trigger if exists orders_rush_fee on public.orders;
-- runs after orders_no_delivery_fee (triggers fire in name order), so the total is already set
create trigger orders_rush_fee before insert on public.orders for each row execute function private.order_rush_fee();

-- an accepted additional price keeps the rush fee in the new total
do $$
declare def text;
begin
  def := pg_get_functiondef('private.respond_order_extra(uuid,boolean)'::regprocedure);
  if position('o.rush_fee' in def) = 0 then
    def := replace(def, 'o.items_subtotal + o.customization_total + add + coalesce(o.delivery_fee, 0)', 'o.items_subtotal + o.customization_total + add + coalesce(o.delivery_fee, 0) + o.rush_fee');
    if position('o.rush_fee' in def) = 0 then raise exception 'respond_order_extra is not the expected version; nothing changed.'; end if;
    execute def;
  end if;
end $$;

-- the order summary in chat shows the rush fee
create or replace function private.chat_order_summary() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders; thread_id uuid; lines jsonb;
begin
  select * into o from public.orders where id = new.id;
  if not found or o.status = 'cancelled' then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', i.name_snapshot, 'option', i.variant_label_snapshot, 'qty', i.quantity, 'total', i.line_total,
      'details', nullif(i.customization->>'summary', ''), 'designed', i.customization ? 'designer') order by i.line_number), '[]'::jsonb)
    into lines from public.order_items i where i.order_id = o.id;
  insert into public.chat_conversations(customer_id, order_id, state) values (o.customer_id, o.id, 'needs_admin')
    on conflict (order_id) where order_id is not null do update set updated_at = now(), state = 'needs_admin'
    returning id into thread_id;
  insert into public.chat_messages(conversation_id, sender_type, message_type, body, order_id, attachments)
    values (thread_id, 'system', 'order_summary',
      'Order #' || o.order_number || ' received. Here is everything you ordered. LexC''s will check it and confirm; payment opens after that.',
      o.id, jsonb_build_object(
        'order_number', o.order_number, 'ordered_at', o.created_at, 'items', lines,
        'items_subtotal', o.items_subtotal, 'customization_total', o.customization_total,
        'delivery_fee', o.delivery_fee, 'delivery_fee_status', o.delivery_fee_status, 'rush_fee', o.rush_fee, 'total', o.total_amount,
        'deposit_due', o.deposit_due, 'deposit_rate', o.deposit_rate,
        'fulfillment', o.fulfillment_method, 'receiving_start', o.receiving_start, 'receiving_end', o.receiving_end,
        'name', o.customer_name, 'phone', o.contact_phone, 'address', o.address, 'notes', nullif(btrim(coalesce(o.notes, '')), '')))
    on conflict (order_id) where message_type = 'order_summary' do nothing;
  return null;
end $$;
revoke all on function private.chat_order_summary() from public;
commit;
