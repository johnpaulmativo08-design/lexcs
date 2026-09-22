-- Inventory RPCs are intentionally callable only by signed-in users; each function also checks the admin role.
revoke all on function public.inventory_action(jsonb) from anon;
revoke all on function public.inventory_snapshot() from anon;
revoke all on function public.read_inventory_notifications(boolean,uuid) from anon;
grant execute on function public.inventory_action(jsonb) to authenticated;
grant execute on function public.inventory_snapshot() to authenticated;
grant execute on function public.read_inventory_notifications(boolean,uuid) to authenticated;
