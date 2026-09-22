-- Demonstrable, operational inventory states based on the baker's imported catalog.
-- This seed is idempotent. It creates real batches and movement-ledger entries;
-- it never creates browser-only QA records.
do $$
declare
  actor uuid;
begin
  select p.id into actor
  from public.profiles p
  join public.user_roles r on r.user_id = p.id
  where r.role = 'admin'
  order by p.created_at
  limit 1;

  if actor is null then
    raise exception 'An Admin profile is required before adding the inventory demonstration history.';
  end if;

  -- The threshold is an item setting, so the Low Stock state remains derived.
  update public.inventory_items set min_stock = 2
  where lower(name) = 'baking soda' and unit = 'kg' and min_stock <> 2;

  -- These are later real-world batches for existing baker inventory items.
  insert into public.inventory_batches
    (item_id, batch_code, quantity_received, received_at, stock_in_date, expires_on, purchase_price, notes)
  select i.id, s.batch_code, s.quantity, s.received_at, s.stock_in_date, s.expires_on, s.purchase_price, s.notes
  from (values
    ('Full Cream Milk', 'mL', 'FCM-002', 2000::numeric, '2026-09-18 10:00:00+08'::timestamptz, '2026-09-18'::date, '2026-09-25'::date, 190::numeric, 'Supplier delivery — use before date confirmed'),
    ('Full Cream Milk', 'mL', 'FCM-003', 4000::numeric, '2026-09-18 11:00:00+08'::timestamptz, '2026-09-18'::date, '2026-10-15'::date, 185::numeric, 'Supplier delivery — later batch'),
    ('Butter', 'pcs', 'BTR-002', 2::numeric, '2026-09-18 09:30:00+08'::timestamptz, '2026-09-18'::date, '2026-12-15'::date, 55::numeric, 'Small replacement delivery')
  ) as s(item_name, unit, batch_code, quantity, received_at, stock_in_date, expires_on, purchase_price, notes)
  join public.inventory_items i on lower(i.name) = lower(s.item_name) and i.unit = s.unit
  on conflict (batch_code) do nothing;

  -- Opening/restock and real operational movements. Deterministic request IDs make reruns safe.
  insert into public.inventory_movements
    (batch_id, quantity_delta, reason, movement_type, note, reference, created_by, request_id, created_at)
  select b.id, s.quantity_delta, s.reason, s.movement_type, s.note, s.reference, actor, md5('lexc-inventory-demo:' || s.event_key)::uuid, s.created_at
  from (values
    ('fcm-002-restock', 'FCM-002', 2000::numeric, 'receipt', 'restock', 'New supplier delivery', null::text, '2026-09-18 10:00:00+08'::timestamptz),
    ('fcm-002-production', 'FCM-002', -500::numeric, 'usage', 'stock_usage', 'Order Production', 'ORD-1048', '2026-09-19 14:30:00+08'::timestamptz),
    ('fcm-002-remake', 'FCM-002', -500::numeric, 'waste', 'remake', 'Remake after quality check', null::text, '2026-09-20 09:15:00+08'::timestamptz),
    ('fcm-003-restock', 'FCM-003', 4000::numeric, 'receipt', 'restock', 'New supplier delivery', null::text, '2026-09-18 11:00:00+08'::timestamptz),
    ('btr-002-restock', 'BTR-002', 2::numeric, 'receipt', 'restock', 'Small replacement delivery', null::text, '2026-09-18 09:30:00+08'::timestamptz),
    ('btr-002-production', 'BTR-002', -2::numeric, 'usage', 'stock_usage', 'Order Production', 'ORD-1052', '2026-09-20 15:20:00+08'::timestamptz),
    ('bds-001-waste', 'BDS-001', -0.2::numeric, 'waste', 'waste', 'Spillage while preparing dry ingredients', null::text, '2026-09-20 16:10:00+08'::timestamptz)
  ) as s(event_key, batch_code, quantity_delta, reason, movement_type, note, reference, created_at)
  join public.inventory_batches b on b.batch_code = s.batch_code
  on conflict (request_id) do nothing;

  -- Materialize changed alert transitions once; the existing function is idempotent.
  perform private.sync_inventory_alerts();
end $$;
