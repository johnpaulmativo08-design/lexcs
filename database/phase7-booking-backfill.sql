-- Backfill real orders created before booking synchronization was introduced.
do $$
declare row_order record;
begin
  for row_order in
    select o.id from public.orders o
    where not exists (select 1 from public.booking_entries b where b.order_id=o.id)
  loop
    perform private.sync_booking_for_order(row_order.id);
  end loop;
end $$;
