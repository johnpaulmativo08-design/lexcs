-- One-off data cleanup requested by LexC's on 2026-10-17 (not a schema change; do not re-run on purpose).
--  1. Orders placed from Oct 12 that are not fully paid are settled in full (recorded as Admin-verified).
--  2. Orders placed before Oct 12 (Manila time) are deleted with everything tied to them: items, payments,
--     bookings, chat threads and messages, reviews and stock allocations.
--  3. Their stock deductions are removed, which returns that stock (stock = sum of movements).
--     Stock records are normally permanent; the guard is lifted only inside this transaction.
begin;

create temporary table old_orders on commit drop as
  select id from public.orders where created_at < ('2026-10-12'::date at time zone 'Asia/Manila');

-- 1. settle what is left
do $$
declare admin_id uuid := (select verified_by from public.order_payment_attempts where verified_by is not null order by verified_at desc limit 1);
begin
  update public.order_payment_attempts a set status = 'paid', verified_at = now(), verified_by = admin_id
  where a.status = 'verification_pending' and a.order_id not in (select id from old_orders);
  update public.order_payment_attempts a set status = 'paid', verified_at = now(), verified_by = admin_id,
    submitted_at = now(), transaction_reference = 'SETTLED-BY-ADMIN', proof_storage_path = 'settled-by-admin'
  where a.status = 'awaiting_payment' and a.order_id not in (select id from old_orders);
  update public.orders o set payment_status = 'paid', amount_paid = o.total_amount
  where o.id not in (select id from old_orders) and o.status <> 'cancelled'
    and o.total_amount is not null and o.payment_status not in ('paid', 'refunded');
end $$;

-- 2 + 3. remove the old orders and give their stock back
alter table public.inventory_movements disable trigger inventory_movements_no_update;
delete from public.inventory_movements
  where order_id in (select id from old_orders)
     or allocation_id in (select id from public.order_inventory_allocations where order_id in (select id from old_orders));
alter table public.inventory_movements enable trigger inventory_movements_no_update;

delete from public.order_inventory_allocation_lines where allocation_id in (select id from public.order_inventory_allocations where order_id in (select id from old_orders));
delete from public.order_inventory_allocations where order_id in (select id from old_orders);
delete from public.inventory_production_runs where order_id in (select id from old_orders);
delete from public.chat_messages
  where order_id in (select id from old_orders)
     or conversation_id in (select id from public.chat_conversations where order_id in (select id from old_orders))
     or payment_id in (select id from public.order_payment_attempts where order_id in (select id from old_orders));
delete from public.chat_conversations where order_id in (select id from old_orders);
delete from public.reviews where order_id in (select id from old_orders);
delete from public.booking_entries where order_id in (select id from old_orders);
delete from public.order_payment_attempts where order_id in (select id from old_orders);
delete from public.order_items where order_id in (select id from old_orders);
delete from public.orders where id in (select id from old_orders);

commit;

-- Follow-up (same day): reservations dated before Oct 12 removed as well (24 rows). Applied live.
delete from public.booking_entries where booking_date < '2026-10-12';
-- Follow-up 2: the 5 remaining reservations with no order (test entries) removed. Applied live.
delete from public.booking_entries where order_id is null and (booking_date, customer_name) in (('2026-10-13','fgggg'),('2026-10-15','awdaw'),('2026-10-17','Irish custorio'),('2026-10-18','Twtwrwra'),('2026-10-23','awdwa'));
