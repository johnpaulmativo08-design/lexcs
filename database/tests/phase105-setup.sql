-- Phase 105 setup (runs BEFORE the migration): a customer, the admin and one cart item.
create temp table rehearsal_ids(k text primary key, id uuid, v numeric);
do $setup$
declare customer_id uuid; admin_id uuid; v public.product_variants;
begin
  select ur.user_id into customer_id from public.user_roles ur where ur.role = 'customer' order by ur.created_at limit 1;
  select ur.user_id into admin_id from public.user_roles ur where ur.role = 'admin' order by ur.created_at limit 1;
  select pv.* into v from public.product_variants pv join public.products pr on pr.id = pv.product_id
   where pv.is_active and pr.status = 'active' and pr.kind = 'standard' and pv.price >= 100 order by pv.price limit 1;
  insert into rehearsal_ids values ('customer', customer_id, null), ('admin', admin_id, null), ('variant', v.id, v.price);
end $setup$;
