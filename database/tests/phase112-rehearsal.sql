-- Phase 112 rehearsal: run AFTER phase112-staff-role.sql. Pretends a customer account is a cashier, tries what a
-- cashier may and may not do, prints the results, then ENDS WITH AN ERROR so every change is undone.
-- Nothing is saved: the account, orders and stock are exactly as before.
do $rehearsal$
declare
  who uuid; ord uuid; item uuid; report text := ''; n integer;
begin
  select r.user_id into who from public.user_roles r where r.role = 'customer' limit 1;
  if who is null then raise exception 'No customer account to rehearse with.'; end if;
  select id into ord from public.orders where status in ('pending', 'confirmed') order by created_at desc limit 1;
  select id into item from public.inventory_items limit 1;
  update public.user_roles set role = 'staff' where user_id = who;
  insert into public.staff_members (user_id) values (who) on conflict (user_id) do update set active = true;

  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  report := report || E'\nlevel: ' || public.my_access_level();
  report := report || E'\nreads orders: ' || (select count(*) from public.orders) || ', bookings: ' || (select count(*) from public.booking_entries) || ', stock items: ' || (select count(*) from public.inventory_items);
  begin perform public.inventory_overview(); report := report || E'\nallowed  inventory overview'; exception when others then report := report || E'\nWRONG    inventory overview refused: ' || sqlerrm; end;
  begin perform public.get_production_day(current_date); report := report || E'\nallowed  production day'; exception when others then report := report || E'\nWRONG    production day refused: ' || sqlerrm; end;

  if ord is not null then
    begin perform public.set_order_status(ord, 'cancelled'); report := report || E'\nWRONG    cashier cancelled an order'; exception when others then report := report || E'\nrefused  cancel order (' || sqlerrm || ')'; end;
    begin perform public.set_order_status(ord, 'confirmed'); report := report || E'\nWRONG    cashier confirmed an order'; exception when others then report := report || E'\nrefused  confirm order (' || sqlerrm || ')'; end;
  end if;
  if item is not null then
    begin perform public.delete_inventory_item(item); report := report || E'\nWRONG    cashier deleted a stock item'; exception when others then report := report || E'\nrefused  delete stock item (' || sqlerrm || ')'; end;
  end if;
  begin perform public.set_payment_method_active('gcash', false); report := report || E'\nWRONG    cashier changed payment methods'; exception when others then report := report || E'\nrefused  payment methods (' || sqlerrm || ')'; end;
  begin perform public.add_staff('someone@example.com'); report := report || E'\nWRONG    cashier added staff'; exception when others then report := report || E'\nrefused  add staff (' || sqlerrm || ')'; end;
  begin update public.user_roles set role = 'admin' where user_id = who; get diagnostics n = row_count;
    report := report || case when n > 0 then E'\nWRONG    cashier made themself owner' else E'\nrefused  change own role (no rows)' end;
  exception when others then report := report || E'\nrefused  change own role (' || sqlerrm || ')'; end;

  raise exception 'REHEARSAL ONLY (nothing saved):%', report;
end $rehearsal$;
