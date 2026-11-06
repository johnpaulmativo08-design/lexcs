-- Phase 103 setup (runs BEFORE the migration in phase103-rehearsal.sql): pretend customer, admin, product and slot.
create temp table rehearsal_ids(k text primary key, id uuid, v numeric);
create temp table rehearsal_payload(p jsonb);
do $setup$
declare customer_id uuid; admin_id uuid; v public.product_variants; slot uuid; method text;
begin
  select ur.user_id into customer_id from public.user_roles ur where ur.role = 'customer' order by ur.created_at limit 1;
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' order by ur.created_at limit 1;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id left join public.categories c on c.id = pr.category_id
   where pv.is_active and pv.min_qty <= 1 and pr.status = 'active' and pr.kind = 'standard' and not coalesce(pr.is_test_product, false)
     and (pr.category_id is null or c.is_active) and pv.price >= 300 order by pv.price desc limit 1;
  select s.id into slot from public.availability_slots s where s.is_open and s.starts_at > now() + interval '4 days'
     and (select count(*) from public.orders o where o.slot_id = s.id and o.status <> 'cancelled') < s.capacity - 3 order by s.starts_at limit 1;
  select code into method from public.payment_methods where active and code <> 'paymongo' order by code limit 1;
  insert into rehearsal_payload values (jsonb_build_object('name', 'Rehearsal', 'phone', '09171234567', 'notes', 'phase 103 rehearsal', 'payment_method', method,
    'fulfillment', 'pickup', 'slot_id', slot, 'items', jsonb_build_array(jsonb_build_object('variant_id', v.id, 'qty', 1))));
  insert into rehearsal_ids values ('customer', customer_id, null), ('admin', admin_id, null), ('variant', v.id, v.price), ('product', v.product_id, null);
end $setup$;
